import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import { AppError } from '../../common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database, type QueryExecutor } from '../../database';
import { hashPassword, verifyPassword } from './password';
import { sessionEvents } from './session-events';

export interface Identity {
  userId: number;
  accountId: number;
  sessionId: string;
  sessionRevision: number;
  role: 'owner' | 'admin' | 'member';
}
export type AuthedRequest = FastifyRequest & { auth: Identity };

@Injectable()
export class AuthService {
  /** 注入数据库与令牌配置，集中处理会话和账号认证逻辑。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** 使用服务端密钥摘要刷新令牌，避免在数据库中保存原始凭证。 */
  private refreshHash(token: string): string {
    return createHmac('sha256', this.config.refreshTokenSecret).update(token).digest('hex');
  }

  /** 根据当前会话签发短期访问令牌。 */
  private accessToken(identity: Omit<Identity, 'role'>): string {
    return jwt.sign(
      {
        uid: identity.userId,
        aid: identity.accountId,
        sid: identity.sessionId,
        rev: identity.sessionRevision,
      },
      this.config.accessTokenSecret,
      { expiresIn: this.config.accessTokenTtlSeconds },
    );
  }

  /** 生成高熵的不透明刷新令牌。 */
  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** 验证访问令牌并从有效会话重新读取账号成员身份。 */
  async authenticate(token: string): Promise<Identity> {
    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, this.config.accessTokenSecret);
      if (typeof decoded === 'string') throw new Error('invalid payload');
      payload = decoded;
    } catch {
      throw new AppError(401, '未登录或登录已失效');
    }
    const result = await this.db.query<{
      user_id: number;
      account_id: number;
      revision: number;
      role: Identity['role'];
    }>(
      `SELECT s.user_id, s.account_id, s.revision, m.role
      FROM refresh_sessions s JOIN account_members m ON m.account_id=s.account_id AND m.user_id=s.user_id AND m.status='active'
      WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [payload.sid],
    );
    const session = result.rows[0];
    if (
      !session ||
      session.user_id !== payload.uid ||
      session.account_id !== payload.aid ||
      session.revision !== payload.rev
    ) {
      throw new AppError(401, '未登录或登录已失效');
    }
    return {
      userId: session.user_id,
      accountId: session.account_id,
      sessionId: String(payload.sid),
      sessionRevision: session.revision,
      role: session.role,
    };
  }

  /** 校验账号密码，并为用户选择的默认个人账号建立会话。 */
  async loginPassword(
    username: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const result = await this.db.query<{ id: number; password_hash: string }>(
      'SELECT id,password_hash FROM users WHERE username=$1 OR mobile=$1 OR email=$1',
      [username],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash)))
      throw new AppError(401, '账号或密码错误');
    const membership = await this.db.query<{ account_id: number }>(
      `SELECT a.id AS account_id FROM accounts a JOIN account_members m ON m.account_id=a.id
      WHERE m.user_id=$1 AND m.status='active' ORDER BY (a.type='personal') DESC,a.id LIMIT 1`,
      [user.id],
    );
    if (!membership.rows[0]) throw new AppError(403, '账号不可用');
    return this.createSession(user.id, membership.rows[0].account_id);
  }

  /** 在指定连接中持久化刷新会话，并返回一对访问和刷新令牌。 */
  private async createSession(
    userId: number,
    accountId: number,
    client?: PoolClient,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const refresh = this.newRefreshToken();
    const sessionId = randomUUID();
    const query: QueryExecutor = client ?? this.db;
    await query.query(
      `INSERT INTO refresh_sessions(id,user_id,account_id,token_hash,expires_at)
      VALUES ($1,$2,$3,$4,now()+($5::text || ' days')::interval)`,
      [sessionId, userId, accountId, this.refreshHash(refresh), this.config.refreshTokenTtlDays],
    );
    return {
      access_token: this.accessToken({ userId, accountId, sessionId, sessionRevision: 1 }),
      refresh_token: refresh,
    };
  }

  /** 原子轮换刷新令牌并使旧访问令牌失效。 */
  async refresh(rawToken: string): Promise<{ access_token: string; refresh_token: string }> {
    const result = await this.db.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        user_id: number;
        account_id: number;
        revision: number;
      }>(
        `SELECT s.id,s.user_id,s.account_id,s.revision FROM refresh_sessions s
        JOIN account_members m ON m.account_id=s.account_id AND m.user_id=s.user_id AND m.status='active'
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() FOR UPDATE OF s`,
        [this.refreshHash(rawToken)],
      );
      const row = result.rows[0];
      if (!row) throw new AppError(401, '刷新凭证无效');
      const refresh = this.newRefreshToken();
      const revision = row.revision + 1;
      await client.query(
        'UPDATE refresh_sessions SET token_hash=$1,revision=$2,updated_at=now() WHERE id=$3',
        [this.refreshHash(refresh), revision, row.id],
      );
      return {
        access_token: this.accessToken({
          userId: row.user_id,
          accountId: row.account_id,
          sessionId: row.id,
          sessionRevision: revision,
        }),
        refresh_token: refresh,
        session_id: row.id,
      };
    });
    sessionEvents.emit('invalidated', result.session_id);
    return { access_token: result.access_token, refresh_token: result.refresh_token };
  }

  /** 验证成员关系后切换当前会话账号并提升会话版本。 */
  async changeAccount(
    identity: Identity,
    accountId: number,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const result = await this.db.transaction(async (client) => {
      const membership = await client.query(
        'SELECT 1 FROM account_members WHERE account_id=$1 AND user_id=$2 AND status=$3',
        [accountId, identity.userId, 'active'],
      );
      if (!membership.rowCount) throw new AppError(404, '账号不存在');
      const session = await client.query<{ revision: number }>(
        'SELECT revision FROM refresh_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE',
        [identity.sessionId, identity.userId],
      );
      if (!session.rows[0] || session.rows[0].revision !== identity.sessionRevision)
        throw new AppError(401, '登录已失效');
      const refresh = this.newRefreshToken();
      const revision = identity.sessionRevision + 1;
      await client.query(
        'UPDATE refresh_sessions SET account_id=$1,revision=$2,token_hash=$3,updated_at=now() WHERE id=$4',
        [accountId, revision, this.refreshHash(refresh), identity.sessionId],
      );
      return {
        access_token: this.accessToken({
          userId: identity.userId,
          accountId,
          sessionId: identity.sessionId,
          sessionRevision: revision,
        }),
        refresh_token: refresh,
      };
    });
    sessionEvents.emit('invalidated', identity.sessionId);
    return result;
  }

  /** 以手机号和验证码生成服务端可验证的摘要。 */
  private smsHash(mobile: string, code: string): string {
    return createHmac('sha256', this.config.refreshTokenSecret)
      .update(`${mobile}:${code}`)
      .digest('hex');
  }

  /** 在开发模拟模式下创建验证码，并以行锁和日限额限制发送频率。 */
  async sendSms(mobile: string, sendType: string): Promise<{ mock: boolean }> {
    const code = this.config.devSmsCode;
    if (!this.config.devMockExternals || !code) throw new AppError(503, '短信服务未配置');
    await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [mobile]);
      const recent = await client.query(
        "SELECT 1 FROM sms_challenges WHERE mobile=$1 AND created_at>now()-interval '60 seconds' LIMIT 1",
        [mobile],
      );
      if (recent.rowCount) throw new AppError(429, '发送过于频繁');
      const today = await client.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM sms_challenges WHERE mobile=$1 AND created_at>now()-interval '1 day'",
        [mobile],
      );
      if (today.rows[0].total >= 10) throw new AppError(429, '今日验证码发送次数已达上限');
      await client.query(
        `UPDATE sms_challenges SET consumed_at=now()
         WHERE mobile=$1 AND send_type=$2 AND consumed_at IS NULL`,
        [mobile, sendType],
      );
      await client.query(
        `INSERT INTO sms_challenges(mobile,send_type,code_hash,expires_at)
         VALUES ($1,$2,$3,now()+interval '5 minutes')`,
        [mobile, sendType, this.smsHash(mobile, code)],
      );
    });
    return { mock: true };
  }

  /** 校验一次性验证码；首次登录时在同一事务中创建用户及个人账号。 */
  async loginSms(
    mobile: string,
    captcha: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    if (!this.config.devMockExternals || !this.config.devSmsCode)
      throw new AppError(503, '短信服务未配置');
    const outcome = await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [mobile]);
      const result = await client.query<{ id: number; code_hash: string; attempts: number }>(
        `SELECT id,code_hash,attempts FROM sms_challenges
        WHERE mobile=$1 AND send_type='login_register' AND consumed_at IS NULL AND expires_at>now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [mobile],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.attempts >= 5) return null;
      await client.query('UPDATE sms_challenges SET attempts=attempts+1 WHERE id=$1', [
        challenge.id,
      ]);
      const expected = Buffer.from(challenge.code_hash, 'hex');
      const actual = Buffer.from(this.smsHash(mobile, captcha), 'hex');
      if (!timingSafeEqual(expected, actual)) return null;
      await client.query('UPDATE sms_challenges SET consumed_at=now() WHERE id=$1', [challenge.id]);
      let user = (
        await client.query<{ id: number }>('SELECT id FROM users WHERE mobile=$1', [mobile])
      ).rows[0];
      if (!user) {
        user = (
          await client.query<{ id: number }>(
            `INSERT INTO users(uuid,username,mobile,password_hash)
          VALUES ($1,$2,$3,$4) RETURNING id`,
            [
              randomUUID(),
              `mobile_${randomUUID()}`,
              mobile,
              await hashPassword(randomBytes(32).toString('hex')),
            ],
          )
        ).rows[0];
        const account = (
          await client.query<{ id: number }>(
            `INSERT INTO accounts(type,name,owner_user_id) VALUES ('personal',$1,$2) RETURNING id`,
            [`用户${mobile.slice(-4)}`, user.id],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO account_members(account_id,user_id,role) VALUES ($1,$2,'owner')`,
          [account.id, user.id],
        );
        await client.query('INSERT INTO credit_wallets(account_id) VALUES ($1)', [account.id]);
      }
      const account = (
        await client.query<{ account_id: number }>(
          `SELECT m.account_id FROM account_members m JOIN accounts a ON a.id=m.account_id
        WHERE m.user_id=$1 AND m.status='active' ORDER BY (a.type='personal') DESC,a.id LIMIT 1`,
          [user.id],
        )
      ).rows[0];
      if (!account) throw new AppError(403, '账号不可用');
      return this.createSession(user.id, account.account_id, client);
    });
    if (!outcome) throw new AppError(401, '验证码无效');
    return outcome;
  }

  /** 校验绑定验证码并确保手机号不会同时关联到其他用户。 */
  async bindPhone(
    identity: Identity,
    mobile: string,
    captcha: string,
  ): Promise<{ mobile: string }> {
    if (!this.config.devMockExternals || !this.config.devSmsCode)
      throw new AppError(503, '短信服务未配置');
    const valid = await this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [mobile]);
      const result = await client.query<{ id: number; code_hash: string; attempts: number }>(
        `SELECT id,code_hash,attempts FROM sms_challenges WHERE mobile=$1 AND send_type='bind_phone'
          AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [mobile],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.attempts >= 5) return false;
      await client.query('UPDATE sms_challenges SET attempts=attempts+1 WHERE id=$1', [
        challenge.id,
      ]);
      const expected = Buffer.from(challenge.code_hash, 'hex');
      const actual = Buffer.from(this.smsHash(mobile, captcha), 'hex');
      if (!timingSafeEqual(expected, actual)) return false;
      const taken = await client.query('SELECT 1 FROM users WHERE mobile=$1 AND id<>$2', [
        mobile,
        identity.userId,
      ]);
      if (taken.rowCount) throw new AppError(409, '手机号已绑定其他账号');
      await client.query('UPDATE users SET mobile=$1,updated_at=now() WHERE id=$2', [
        mobile,
        identity.userId,
      ]);
      await client.query('UPDATE sms_challenges SET consumed_at=now() WHERE id=$1', [challenge.id]);
      return true;
    });
    if (!valid) throw new AppError(401, '验证码无效');
    return { mobile };
  }
}
