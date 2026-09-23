import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Query,
  Body,
  Headers,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError, parse } from './common';
import { APP_CONFIG, type AppConfig } from './config';
import { Database, type QueryExecutor } from './database';
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

const idSchema = z.coerce.number().int().positive();
const bearer = (header: string | undefined): string => {
  const match = /^Bearer (\S+)$/i.exec(header ?? '');
  if (!match) throw new AppError(401, '未登录或登录已失效');
  return match[1];
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private refreshHash(token: string): string {
    return createHmac('sha256', this.config.refreshTokenSecret).update(token).digest('hex');
  }

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

  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

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

  private smsHash(mobile: string, code: string): string {
    return createHmac('sha256', this.config.refreshTokenSecret)
      .update(`${mobile}:${code}`)
      .digest('hex');
  }

  async sendSms(mobile: string, sendType: string): Promise<{ mock: boolean }> {
    if (!this.config.devMockExternals || !this.config.devSmsCode)
      throw new AppError(503, '短信服务未配置');
    const recent = await this.db.query(
      "SELECT 1 FROM sms_challenges WHERE mobile=$1 AND send_type=$2 AND created_at>now()-interval '60 seconds' LIMIT 1",
      [mobile, sendType],
    );
    if (recent.rowCount) throw new AppError(429, '发送过于频繁');
    await this.db.query(
      `INSERT INTO sms_challenges(mobile,send_type,code_hash,expires_at)
      VALUES ($1,$2,$3,now()+interval '5 minutes')`,
      [mobile, sendType, this.smsHash(mobile, this.config.devSmsCode)],
    );
    return { mock: true };
  }

  async loginSms(
    mobile: string,
    captcha: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    if (!this.config.devMockExternals) throw new AppError(503, '短信服务未配置');
    const outcome = await this.db.transaction(async (client) => {
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
              `mobile_${mobile}`,
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
      return this.createSession(user.id, account.account_id, client);
    });
    if (!outcome) throw new AppError(401, '验证码无效');
    return outcome;
  }

  async bindPhone(
    identity: Identity,
    mobile: string,
    captcha: string,
  ): Promise<{ mobile: string }> {
    if (!this.config.devMockExternals) throw new AppError(503, '短信服务未配置');
    const valid = await this.db.transaction(async (client) => {
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

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    request.auth = await this.auth.authenticate(bearer(request.headers.authorization));
    return true;
  }
}

@Controller('api')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly db: Database,
  ) {}

  @Post('login/password')
  loginPassword(@Body() body: unknown) {
    const input = parse(
      z.object({ username: z.string().min(1).max(255), password: z.string().min(1).max(255) }),
      body,
    );
    return this.auth.loginPassword(input.username, input.password);
  }

  @Post('sms/send')
  sendSms(@Body() body: unknown) {
    const input = parse(
      z.object({
        mobile: z.string().regex(/^1\d{10}$/),
        sendType: z.enum(['login_register', 'bind_phone']),
      }),
      body,
    );
    return this.auth.sendSms(input.mobile, input.sendType);
  }

  @Post('login/sms')
  loginSms(@Body() body: unknown) {
    const input = parse(
      z.object({ mobile: z.string().regex(/^1\d{10}$/), captcha: z.string().regex(/^\d{6}$/) }),
      body,
    );
    return this.auth.loginSms(input.mobile, input.captcha);
  }

  @Post('login/wechat')
  loginWechat() {
    throw new AppError(503, '微信登录未配置');
  }

  @Post('user/bindPhone')
  @UseGuards(AuthGuard)
  bindPhone(@Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parse(
      z.object({ mobile: z.string().regex(/^1\d{10}$/), captcha: z.string().regex(/^\d{6}$/) }),
      body,
    );
    return this.auth.bindPhone(request.auth, input.mobile, input.captcha);
  }

  @Post('auth/refresh')
  refresh(@Headers('authorization') authorization?: string) {
    return this.auth.refresh(bearer(authorization));
  }

  @Get('user/info')
  @UseGuards(AuthGuard)
  async info(@Req() request: AuthedRequest) {
    const result = await this.db.query<{
      uuid: string;
      avatar: string | null;
      account_name: string;
      account_type: string;
    }>(
      `SELECT u.uuid,u.avatar,a.name AS account_name,a.type AS account_type
      FROM users u JOIN accounts a ON a.id=$2 WHERE u.id=$1`,
      [request.auth.userId, request.auth.accountId],
    );
    const row = result.rows[0];
    return {
      account_id: request.auth.accountId,
      account_name: row.account_name,
      account_type: row.account_type,
      avatar: row.avatar,
      is_vip: false,
      vip_level: 0,
      plan_expire: null,
      plan_title: '',
      role_name: request.auth.role,
      uuid: row.uuid,
    };
  }

  @Get('account')
  @UseGuards(AuthGuard)
  async accounts(@Req() request: AuthedRequest) {
    const result = await this.db.query(
      `SELECT a.id AS account_id,a.name AS account_name,a.type AS account_type,m.role AS role_name
      FROM accounts a JOIN account_members m ON m.account_id=a.id WHERE m.user_id=$1 AND m.status='active' ORDER BY a.id`,
      [request.auth.userId],
    );
    return { list: result.rows };
  }

  @Post('account/change')
  @UseGuards(AuthGuard)
  changeAccount(@Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ account_id: idSchema }), body);
    return this.auth.changeAccount(request.auth, input.account_id);
  }

  @Get('credit')
  @UseGuards(AuthGuard)
  async credit(@Req() request: AuthedRequest) {
    const result = await this.db.query<{ balance: number }>(
      'SELECT balance FROM credit_wallets WHERE account_id=$1',
      [request.auth.accountId],
    );
    const balance = result.rows[0]?.balance ?? 0;
    return { total_balance: balance, use_credit: balance, credit_quota: balance };
  }

  @Get('credit/bill')
  @UseGuards(AuthGuard)
  async bills(
    @Req() request: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
  ) {
    const pagination = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      { page, limit },
    );
    const [rows, count] = await Promise.all([
      this.db.query(
        'SELECT id,source_key,amount,balance_after,created_at FROM credit_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',
        [request.auth.accountId, pagination.limit, (pagination.page - 1) * pagination.limit],
      ),
      this.db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM credit_ledger WHERE account_id=$1',
        [request.auth.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  @Get('home/init')
  @UseGuards(AuthGuard)
  homeInit() {
    return { model_enabled: false };
  }
}
