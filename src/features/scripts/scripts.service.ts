import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { z } from 'zod';
import { AppError } from '../../common';
import { Database, type QueryExecutor } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import type { confirmStep, createScript, updateScript, updateStep } from './scripts.schemas';

const STEP_NAMES = [
  '故事背景',
  '人物角色',
  '全剧大纲',
  '人物关系',
  '人物弧光',
  '分集大纲',
  '逐集剧本',
] as const;

interface ScriptRow extends QueryResultRow {
  id: number;
  account_id: number;
  created_by: number;
  title: string;
  input_text: string;
  attr_ids: number[];
  model_code: string;
  status: string;
  current_step: number;
  episode_count: number;
  episode_duration: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  permission_code?: string;
}

interface StepRow extends QueryResultRow {
  id: number;
  script_id: number;
  step: number;
  episode_id: number | null;
  step_name: string;
  status: string;
  content: string;
  has_confirmed: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface EpisodeRow extends QueryResultRow {
  id: number;
  episode_num: number;
  title: string;
  content: string;
  status: string;
  has_confirmed: boolean;
  version: number;
}

/** 将剧本数据库行转换为当前 Nuxt 列表协议。 */
function scriptSummary(row: ScriptRow) {
  return {
    id: row.id,
    script_id: row.id,
    title: row.title,
    input_text: row.input_text,
    status: row.status,
    step: row.current_step,
    model: row.model_code,
    episode_count: row.episode_count,
    episode_duration: row.episode_duration,
    account_id: row.account_id,
    create_by: row.created_by,
    create_time: row.created_at.toISOString(),
    update_time: row.updated_at.toISOString(),
    delete_time: row.deleted_at?.toISOString() ?? null,
    revision: row.revision,
    permissions: { permission_code: row.permission_code ?? 'owner' },
  };
}

@Injectable()
export class ScriptsService {
  /** 管理剧本草稿、步骤版本、回收站和个人导入。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 保存剧本草稿并创建固定七步，生成仍需独立供应商与价格配置。 */
  async create(
    actor: Identity,
    input: z.infer<typeof createScript>,
  ): Promise<{ script_id: number }> {
    const attrIds = input.attr_ids ? input.attr_ids.split(',').map(Number) : [];
    if (new Set(attrIds).size !== attrIds.length) throw new AppError(400, '剧本属性不得重复');
    return this.db.transaction(async (client) => {
      await this.permissions.assertCanCreate(actor, client);
      const created = await client.query<{ id: number }>(
        `INSERT INTO scripts(account_id,created_by,title,input_text,attr_ids,model_code,
         episode_count,episode_duration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          actor.accountId,
          actor.userId,
          input.title,
          input.input_text,
          attrIds,
          input.model_code,
          input.episode_count,
          input.episode_duration,
        ],
      );
      const scriptId = created.rows[0].id;
      for (let index = 0; index < STEP_NAMES.length; index++)
        await client.query('INSERT INTO script_steps(script_id,step,step_name) VALUES ($1,$2,$3)', [
          scriptId,
          index + 1,
          STEP_NAMES[index],
        ]);
      return { script_id: scriptId };
    });
  }

  /** 分页列出账号可见剧本，显式 none 权限会立即隐藏项目。 */
  async list(
    actor: Identity,
    page: number,
    limit: number,
    name?: string,
    personal = false,
  ): Promise<{ list: ReturnType<typeof scriptSummary>[]; total: number }> {
    const accountId = personal ? await this.personalAccount(actor) : actor.accountId;
    const role = personal ? 'owner' : actor.role;
    const values = [accountId, role, actor.userId, name ?? null];
    const where = `s.account_id=$1 AND s.deleted_at IS NULL
      AND ($2::text<>'member' OR COALESCE(p.permission_code,'editor')<>'none')
      AND ($4::text IS NULL OR strpos(lower(s.title),lower($4))>0)`;
    const [rows, count] = await Promise.all([
      this.db.query<ScriptRow>(
        `SELECT s.*,CASE WHEN $2::text='member' THEN COALESCE(p.permission_code,'editor') ELSE 'owner' END AS permission_code
         FROM scripts s LEFT JOIN project_permissions p ON p.account_id=s.account_id AND p.project_type='script'
           AND p.project_id=s.id AND p.user_id=$3
         WHERE ${where} ORDER BY s.id DESC LIMIT $5 OFFSET $6`,
        [...values, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM scripts s LEFT JOIN project_permissions p
         ON p.account_id=s.account_id AND p.project_type='script' AND p.project_id=s.id AND p.user_id=$3
         WHERE ${where}`,
        values,
      ),
    ]);
    return { list: rows.rows.map(scriptSummary), total: count.rows[0].total };
  }

  /** 仅允许导入当前用户实际拥有的个人剧本。 */
  private async personalAccount(actor: Identity, query: QueryExecutor = this.db): Promise<number> {
    const result = await query.query<{ id: number }>(
      `SELECT a.id FROM accounts a JOIN account_members m ON m.account_id=a.id
       WHERE a.type='personal' AND a.owner_user_id=$1 AND a.dissolved_at IS NULL
       AND m.user_id=$1 AND m.status='active' ORDER BY a.id LIMIT 1`,
      [actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '个人账号不存在');
    return result.rows[0].id;
  }

  /** 返回剧本详情、步骤和已保存的分集。 */
  async detail(actor: Identity, scriptId: number): Promise<Record<string, unknown>> {
    const code = await this.permissions.projectCode(actor, 'script', scriptId);
    if (code === 'none') throw new AppError(404, '剧本不存在');
    const [script, steps, episodes] = await Promise.all([
      this.db.query<ScriptRow>(
        'SELECT * FROM scripts WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL',
        [scriptId, actor.accountId],
      ),
      this.db.query<StepRow>(
        'SELECT * FROM script_steps WHERE script_id=$1 AND episode_id IS NULL ORDER BY step',
        [scriptId],
      ),
      this.db.query<EpisodeRow>(
        'SELECT * FROM script_episodes WHERE script_id=$1 ORDER BY episode_num',
        [scriptId],
      ),
    ]);
    const row = script.rows[0];
    if (!row) throw new AppError(404, '剧本不存在');
    return {
      id: row.id,
      script_id: row.id,
      user_id: row.created_by,
      creator_by: row.created_by,
      name: row.title,
      title: row.title,
      input_text: row.input_text,
      status: row.status,
      step: row.current_step,
      episode_count: row.episode_count,
      episode_duration: row.episode_duration,
      llm: row.model_code,
      model: row.model_code,
      attrs: row.attr_ids.map((id) => ({ id })),
      options: null,
      revision: row.revision,
      permissions: { permission_code: code },
      steps: steps.rows.map((step) => ({
        step_id: step.id,
        script_id: step.script_id,
        step: step.step,
        step_name: step.step_name,
        status: step.status,
        content: step.content,
        has_confirmed: step.has_confirmed ? 1 : 0,
        version: step.version,
        create_time: step.created_at.getTime(),
        update_time: step.updated_at.getTime(),
      })),
      episodes: episodes.rows.map((episode) => ({
        episodes_id: episode.id,
        episode_num: episode.episode_num,
        title: episode.title,
        content: episode.content,
        status: episode.status,
        has_confirmed: episode.has_confirmed ? 1 : 0,
        version: episode.version,
      })),
      processingTasks: null,
      create_time: row.created_at.getTime(),
      update_time: row.updated_at.getTime(),
      delete_time: 0,
      team_id: row.account_id,
    };
  }

  /** 串行更新剧本基础字段；新版客户端可用 expected_revision 检测旧稿覆盖。 */
  async update(
    actor: Identity,
    input: z.infer<typeof updateScript>,
  ): Promise<{ script_id: number; revision: number }> {
    return this.db.transaction(async (client) => {
      await this.permissions.assertProject(actor, 'script', input.script_id, 'edit', client);
      const current = await client.query<{ revision: number }>(
        'SELECT revision FROM scripts WHERE id=$1 FOR UPDATE',
        [input.script_id],
      );
      if (input.expected_revision && current.rows[0].revision !== input.expected_revision)
        throw new AppError(409, '剧本版本冲突', { current_revision: current.rows[0].revision });
      const updated = await client.query<{ revision: number }>(
        `UPDATE scripts SET title=COALESCE($1,title),episode_count=COALESCE($2,episode_count),
         episode_duration=COALESCE($3,episode_duration),revision=revision+1,updated_at=now()
         WHERE id=$4 RETURNING revision`,
        [
          input.title ?? null,
          input.episode_count ?? null,
          input.episode_duration ?? null,
          input.script_id,
        ],
      );
      return { script_id: input.script_id, revision: updated.rows[0].revision };
    });
  }

  /** 保存人工编辑的步骤内容，并增加步骤与剧本版本。 */
  async updateStep(
    actor: Identity,
    input: z.infer<typeof updateStep>,
  ): Promise<{ script_id: number; step_id: number; version: number }> {
    if (!input.content.trim()) throw new AppError(400, '步骤内容不能为空');
    return this.db.transaction(async (client) => {
      await this.permissions.assertProject(actor, 'script', input.script_id, 'edit', client);
      await client.query('SELECT id FROM scripts WHERE id=$1 FOR UPDATE', [input.script_id]);
      const current = await client.query<StepRow>(
        `SELECT * FROM script_steps WHERE id=$1 AND script_id=$2 AND episode_id IS NOT DISTINCT FROM $3::int FOR UPDATE`,
        [input.step_id, input.script_id, input.episode_id ?? null],
      );
      const step = current.rows[0];
      if (!step) throw new AppError(404, '步骤不存在');
      if (input.expected_version && step.version !== input.expected_version)
        throw new AppError(409, '步骤版本冲突', { current_version: step.version });
      const updated = await client.query<{ version: number }>(
        `UPDATE script_steps SET content=$1,status='finished',has_confirmed=false,
         version=version+1,updated_at=now() WHERE id=$2 RETURNING version`,
        [input.content, step.id],
      );
      if (input.episode_id)
        await client.query(
          `UPDATE script_episodes SET content=$1,status='finished',has_confirmed=false,
           version=version+1,updated_at=now() WHERE id=$2 AND script_id=$3`,
          [input.content, input.episode_id, input.script_id],
        );
      await client.query(
        `UPDATE scripts SET status=CASE WHEN status='draft' THEN 'creating' ELSE status END,
         revision=revision+1,updated_at=now() WHERE id=$1`,
        [input.script_id],
      );
      return { script_id: input.script_id, step_id: step.id, version: updated.rows[0].version };
    });
  }

  /** 确认已有内容的步骤，同一步重复确认保持幂等。 */
  async confirmStep(
    actor: Identity,
    input: z.infer<typeof confirmStep>,
  ): Promise<{ script_id: number; step_id: number; has_confirmed: boolean }> {
    return this.db.transaction(async (client) => {
      await this.permissions.assertProject(actor, 'script', input.script_id, 'edit', client);
      await client.query('SELECT id FROM scripts WHERE id=$1 FOR UPDATE', [input.script_id]);
      const current = await client.query<StepRow>(
        `SELECT * FROM script_steps WHERE id=$1 AND script_id=$2 AND episode_id IS NOT DISTINCT FROM $3::int FOR UPDATE`,
        [input.step_id, input.script_id, input.episode_id ?? null],
      );
      const step = current.rows[0];
      if (!step) throw new AppError(404, '步骤不存在');
      if (input.expected_version && step.version !== input.expected_version)
        throw new AppError(409, '步骤版本冲突', { current_version: step.version });
      if (step.status !== 'finished' || !step.content.trim())
        throw new AppError(409, '步骤尚无可确认内容');
      if (!step.has_confirmed) {
        await client.query(
          `UPDATE script_steps SET has_confirmed=true,version=version+1,updated_at=now() WHERE id=$1`,
          [step.id],
        );
        if (input.episode_id)
          await client.query(
            `UPDATE script_episodes SET has_confirmed=true,version=version+1,updated_at=now()
             WHERE id=$1 AND script_id=$2`,
            [input.episode_id, input.script_id],
          );
        const unconfirmed =
          step.step === 7
            ? await client.query(
                `SELECT 1 FROM script_episodes WHERE script_id=$1 AND NOT has_confirmed LIMIT 1`,
                [input.script_id],
              )
            : null;
        const finished = step.step === 7 && !unconfirmed?.rowCount;
        await client.query(
          `UPDATE scripts SET current_step=GREATEST(current_step,LEAST($1::int+1,7)),
           status=CASE WHEN $3::boolean THEN 'finished' ELSE status END,
           revision=revision+1,updated_at=now() WHERE id=$2`,
          [step.step, input.script_id, finished],
        );
      }
      return { script_id: input.script_id, step_id: step.id, has_confirmed: true };
    });
  }

  /** 批量将剧本移入回收站，删除权只属于团队所有者或管理员。 */
  async recycle(actor: Identity, ids: number[]): Promise<{ deleted_ids: number[] }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    if (new Set(ids).size !== ids.length) throw new AppError(400, '剧本 ID 不得重复');
    return this.db.transaction(async (client) => {
      const result = await client.query<{ id: number }>(
        `UPDATE scripts SET deleted_at=now(),updated_at=now(),revision=revision+1
         WHERE id=ANY($1::int[]) AND account_id=$2 AND deleted_at IS NULL RETURNING id`,
        [ids, actor.accountId],
      );
      if (result.rows.length !== ids.length) throw new AppError(404, '剧本不存在');
      return { deleted_ids: ids };
    });
  }

  /** 分页列出当前账号的剧本回收站。 */
  async recycled(
    actor: Identity,
    page: number,
    limit: number,
    name?: string,
  ): Promise<{ list: ReturnType<typeof scriptSummary>[]; total: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有回收站权限');
    const values = [actor.accountId, name ?? null];
    const [rows, count] = await Promise.all([
      this.db.query<ScriptRow>(
        `SELECT * FROM scripts WHERE account_id=$1 AND deleted_at IS NOT NULL
         AND ($2::text IS NULL OR strpos(lower(title),lower($2))>0)
         ORDER BY deleted_at DESC,id DESC LIMIT $3 OFFSET $4`,
        [...values, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM scripts WHERE account_id=$1 AND deleted_at IS NOT NULL
         AND ($2::text IS NULL OR strpos(lower(title),lower($2))>0)`,
        values,
      ),
    ]);
    return { list: rows.rows.map(scriptSummary), total: count.rows[0].total };
  }

  /** 从回收站恢复单个剧本。 */
  async restore(actor: Identity, scriptId: number): Promise<{ script_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有恢复权限');
    const restored = await this.db.query(
      `UPDATE scripts SET deleted_at=NULL,revision=revision+1,updated_at=now()
       WHERE id=$1 AND account_id=$2 AND deleted_at IS NOT NULL RETURNING id`,
      [scriptId, actor.accountId],
    );
    if (!restored.rowCount) throw new AppError(404, '回收站剧本不存在');
    return { script_id: scriptId };
  }

  /** 永久删除已经回收的剧本及其步骤。 */
  async destroy(actor: Identity, scriptId: number): Promise<{ script_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    const deleted = await this.db.query(
      `DELETE FROM scripts WHERE id=$1 AND account_id=$2 AND deleted_at IS NOT NULL RETURNING id`,
      [scriptId, actor.accountId],
    );
    if (!deleted.rowCount) throw new AppError(404, '回收站剧本不存在');
    return { script_id: scriptId };
  }

  /** 复制个人账号剧本及步骤、分集，保留原稿与版本内容。 */
  async importPersonal(actor: Identity, ids: number[]): Promise<{ imported_ids: number[] }> {
    if (new Set(ids).size !== ids.length) throw new AppError(400, '剧本 ID 不得重复');
    const personalId = await this.personalAccount(actor);
    if (personalId === actor.accountId) throw new AppError(400, '只能导入到团队账号');
    return this.db.transaction(async (client) => {
      const account = await client.query(
        `SELECT 1 FROM accounts WHERE id=$1 AND type='team' AND dissolved_at IS NULL FOR SHARE`,
        [actor.accountId],
      );
      if (!account.rowCount) throw new AppError(400, '只能导入到团队账号');
      await this.permissions.assertCanCreate(actor, client);
      const scripts = await client.query<ScriptRow>(
        `SELECT * FROM scripts WHERE id=ANY($1::int[]) AND account_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE`,
        [ids, personalId],
      );
      if (scripts.rows.length !== ids.length) throw new AppError(404, '个人剧本不存在');
      const copied = new Map<number, number>();
      for (const script of scripts.rows) {
        const created = await client.query<{ id: number }>(
          `INSERT INTO scripts(account_id,created_by,title,input_text,attr_ids,model_code,status,current_step,
           episode_count,episode_duration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            actor.accountId,
            actor.userId,
            script.title,
            script.input_text,
            script.attr_ids,
            script.model_code,
            script.status,
            script.current_step,
            script.episode_count,
            script.episode_duration,
          ],
        );
        const newId = created.rows[0].id;
        copied.set(script.id, newId);
        const episodes = await client.query<EpisodeRow>(
          'SELECT * FROM script_episodes WHERE script_id=$1 ORDER BY id',
          [script.id],
        );
        const episodeIds = new Map<number, number>();
        for (const episode of episodes.rows) {
          const newEpisode = await client.query<{ id: number }>(
            `INSERT INTO script_episodes(script_id,episode_num,title,content,status,has_confirmed)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [
              newId,
              episode.episode_num,
              episode.title,
              episode.content,
              episode.status,
              episode.has_confirmed,
            ],
          );
          episodeIds.set(episode.id, newEpisode.rows[0].id);
        }
        const steps = await client.query<StepRow>(
          'SELECT * FROM script_steps WHERE script_id=$1 ORDER BY id',
          [script.id],
        );
        for (const step of steps.rows)
          await client.query(
            `INSERT INTO script_steps(script_id,step,episode_id,step_name,status,content,has_confirmed)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              newId,
              step.step,
              step.episode_id ? episodeIds.get(step.episode_id) : null,
              step.step_name,
              step.status,
              step.content,
              step.has_confirmed,
            ],
          );
      }
      return {
        imported_ids: ids.map((id) => {
          const newId = copied.get(id);
          if (!newId) throw new AppError(409, '剧本导入失败');
          return newId;
        }),
      };
    });
  }

  /** 剧本生成与优化依赖未配置的供应商和服务端价格，不能返回虚假的成功任务。 */
  async unavailableGeneration(actor: Identity, scriptId: number): Promise<never> {
    await this.permissions.assertProject(actor, 'script', scriptId, 'generate');
    throw new AppError(503, '剧本生成供应商及价格未配置');
  }

  /** 当前缺少可核验的剧本模型与定价配置。 */
  getCost(): never {
    throw new AppError(503, '剧本模型价格未配置');
  }

  /** 剧本属性和模型选项在缺少供应商目录时明确不可用。 */
  attrs(): never {
    throw new AppError(503, '剧本模型目录未配置');
  }
}
