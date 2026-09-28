import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

export interface VoiceQuery {
  page: number;
  limit: number;
  type: 'system' | 'custom' | 'collection';
  voice_name?: string;
  age_group?: string;
  gender?: string;
  language?: string;
  accent?: number;
}
export interface VoiceFields {
  id?: number;
  voice_url: string;
  voice_id: string;
  voice_name: string;
  language: string;
  age_group: number;
  gender: number;
  desc: string;
}

@Injectable()
export class VoiceService {
  /** 系统音色和当前用户音色由持久目录提供，克隆仍依赖外部供应商。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 按系统、本人或收藏范围分页查询音色。 */
  async list(actor: Identity, input: VoiceQuery): Promise<{ list: unknown[]; total: number }> {
    const params: unknown[] = [
      actor.userId,
      actor.accountId,
      input.type,
      input.voice_name ?? null,
      input.age_group ?? null,
      input.gender ?? null,
      input.language ?? null,
      input.accent ?? null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `(($3='system' AND v.account_id IS NULL) OR
       ($3='custom' AND v.account_id=$2 AND v.created_by=$1) OR
       ($3='collection' AND vc.user_id IS NOT NULL AND (v.account_id IS NULL OR (v.account_id=$2 AND v.created_by=$1))))
       AND ($4::text IS NULL OR v.voice_name ILIKE '%' || $4 || '%')
       AND ($5::text IS NULL OR v.age_group::text=$5)
       AND ($6::text IS NULL OR v.gender::text=$6)
       AND ($7::text IS NULL OR v.language=$7)
       AND ($8::int IS NULL OR v.accent=$8)`;
    const from = `FROM voice_catalog v LEFT JOIN voice_collections vc ON vc.voice_id=v.id AND vc.user_id=$1 WHERE ${filter}`;
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT v.id,v.voice_id,v.voice_name,v.voice_url,v.language,v.accent,v.gender,v.age_group,
         v.description AS "desc",vc.user_id IS NOT NULL AS is_collect ${from}
         ORDER BY v.id DESC LIMIT $9 OFFSET $10`,
        params,
      ),
      this.db.query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, params.slice(0, 8)),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 切换当前用户对可见音色的收藏。 */
  async toggleCollection(
    actor: Identity,
    voiceId: string,
  ): Promise<{ voice_id: string; is_collect: boolean }> {
    return this.db.transaction(async (client) => {
      const voice = await client.query<{ id: number }>(
        `SELECT id FROM voice_catalog WHERE voice_id=$1 AND
         (account_id IS NULL OR (account_id=$2 AND created_by=$3)) FOR UPDATE`,
        [voiceId, actor.accountId, actor.userId],
      );
      if (!voice.rows[0]) throw new AppError(404, '音色不存在');
      const removed = await client.query(
        'DELETE FROM voice_collections WHERE user_id=$1 AND voice_id=$2 RETURNING voice_id',
        [actor.userId, voice.rows[0].id],
      );
      if (removed.rowCount) return { voice_id: voiceId, is_collect: false };
      await client.query('INSERT INTO voice_collections(user_id,voice_id) VALUES ($1,$2)', [
        actor.userId,
        voice.rows[0].id,
      ]);
      return { voice_id: voiceId, is_collect: true };
    });
  }

  /** 只允许更新本人登记的音色，供应商 voice_id 不可被改写。 */
  async update(actor: Identity, input: VoiceFields & { id: number }): Promise<{ id: number }> {
    return this.db.transaction(async (client) => {
      const existing = await client.query<{ voice_id: string; voice_url: string }>(
        'SELECT voice_id,voice_url FROM voice_catalog WHERE id=$1 AND account_id=$2 AND created_by=$3 FOR UPDATE',
        [input.id, actor.accountId, actor.userId],
      );
      if (!existing.rows[0]) throw new AppError(404, '音色不存在');
      if (existing.rows[0].voice_id !== input.voice_id)
        throw new AppError(409, '音色业务 ID 不能修改');
      if (existing.rows[0].voice_url !== input.voice_url) {
        const asset = await client.query(
          'SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3',
          [actor.accountId, input.voice_url, 'audio/%'],
        );
        if (!asset.rowCount) throw new AppError(404, '试听音频不存在');
      }
      await client.query(
        `UPDATE voice_catalog SET voice_url=$1,voice_name=$2,language=$3,age_group=$4,gender=$5,
         description=$6,updated_at=now() WHERE id=$7`,
        [
          input.voice_url,
          input.voice_name,
          input.language,
          input.age_group,
          input.gender,
          input.desc,
          input.id,
        ],
      );
      return { id: input.id };
    });
  }

  /** 删除本人音色记录及依赖该记录的收藏。 */
  async delete(actor: Identity, id: number): Promise<{ id: number }> {
    const result = await this.db.query(
      'DELETE FROM voice_catalog WHERE id=$1 AND account_id=$2 AND created_by=$3 RETURNING id',
      [id, actor.accountId, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '音色不存在');
    return { id };
  }

  /** 克隆结果必须有供应商可验证的任务来源，当前未配置时不登记外部 ID。 */
  unavailable(): never {
    throw new AppError(503, '声音克隆供应商未配置');
  }

  /** 登记前确认试听地址属于当前账号，供应商结果目前仍无法验签。 */
  async unavailableCreate(actor: Identity, voiceUrl: string): Promise<never> {
    const asset = await this.db.query(
      'SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3',
      [actor.accountId, voiceUrl, 'audio/%'],
    );
    if (!asset.rowCount) throw new AppError(404, '试听音频不存在');
    return this.unavailable();
  }

  /** 验证克隆样本由当前账号登记，然后报告供应商不可用。 */
  async clone(actor: Identity, sampleUrl: string): Promise<never> {
    const asset = await this.db.query(
      'SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3',
      [actor.accountId, sampleUrl, 'audio/%'],
    );
    if (!asset.rowCount) throw new AppError(404, '声音样本不存在');
    return this.unavailable();
  }
}
