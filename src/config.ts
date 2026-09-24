import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  PUBLIC_API_ORIGIN: z.string().url().optional(),
  PUBLIC_WS_ORIGIN: z.string().url().optional(),
  DATABASE_URL: z.string().url().default('postgres://aimanju:aimanju@localhost:5432/aimanju'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  REFRESH_TOKEN_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ALLOWED_WEB_ORIGINS: z.string().default(''),
  WS_ALLOWED_ORIGINS: z.string().default(''),
  DEV_MOCK_EXTERNALS: z.enum(['true', 'false']).default('false'),
  DEV_SMS_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MAX_BATCH_NODES: z.coerce.number().int().min(1).max(1000).default(200),
  MAX_BATCH_CONNECTIONS: z.coerce.number().int().min(1).max(2000).default(400),
  MAX_GENERATION_TASKS: z.coerce.number().int().min(1).max(100).default(20),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  publicApiOrigin?: string;
  publicWsOrigin?: string;
  databaseUrl: string;
  redisUrl: string;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  allowedWebOrigins: string[];
  wsAllowedOrigins: string[];
  devMockExternals: boolean;
  devSmsCode?: string;
  logLevel: string;
  maxBatchNodes: number;
  maxBatchConnections: number;
  maxGenerationTasks: number;
}

/** NestJS 中注入经过校验的应用配置时使用的令牌。 */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** 将逗号分隔的来源列表校验并转换为规范化 origin。 */
function origins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== item.replace(/\/$/, '')) {
        throw new Error(`Invalid origin: ${item}`);
      }
      return url.origin;
    });
}

/** 解析环境变量并拒绝不安全或互相矛盾的部署配置。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  const value = parsed.data;
  if (!['postgres:', 'postgresql:'].includes(new URL(value.DATABASE_URL).protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!['redis:', 'rediss:'].includes(new URL(value.REDIS_URL).protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const allowedWebOrigins = origins(value.ALLOWED_WEB_ORIGINS);
  const wsAllowedOrigins = origins(value.WS_ALLOWED_ORIGINS);
  if (
    value.NODE_ENV === 'production' &&
    (!value.ACCESS_TOKEN_SECRET || !value.REFRESH_TOKEN_SECRET)
  ) {
    throw new Error('Production requires ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET');
  }
  if (value.NODE_ENV === 'production' && value.DEV_MOCK_EXTERNALS === 'true') {
    throw new Error('DEV_MOCK_EXTERNALS is forbidden in production');
  }
  if (value.NODE_ENV === 'production') {
    if (
      !env.DATABASE_URL ||
      !env.REDIS_URL ||
      !value.PUBLIC_API_ORIGIN ||
      !value.PUBLIC_WS_ORIGIN
    ) {
      throw new Error(
        'Production requires DATABASE_URL, REDIS_URL, PUBLIC_API_ORIGIN and PUBLIC_WS_ORIGIN',
      );
    }
    if (
      new URL(value.PUBLIC_API_ORIGIN).protocol !== 'https:' ||
      new URL(value.PUBLIC_WS_ORIGIN).protocol !== 'wss:' ||
      new URL(value.PUBLIC_API_ORIGIN).origin !== value.PUBLIC_API_ORIGIN.replace(/\/$/, '') ||
      new URL(value.PUBLIC_WS_ORIGIN).origin !== value.PUBLIC_WS_ORIGIN.replace(/\/$/, '')
    ) {
      throw new Error('Production requires HTTPS and WSS public origins');
    }
    if (!allowedWebOrigins.length || !wsAllowedOrigins.length) {
      throw new Error('Production requires ALLOWED_WEB_ORIGINS and WS_ALLOWED_ORIGINS');
    }
    if (
      [...allowedWebOrigins, ...wsAllowedOrigins].some((origin) => !origin.startsWith('https://'))
    ) {
      throw new Error('Production browser origins must use HTTPS');
    }
  }
  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    publicApiOrigin: value.PUBLIC_API_ORIGIN,
    publicWsOrigin: value.PUBLIC_WS_ORIGIN,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    accessTokenSecret: value.ACCESS_TOKEN_SECRET ?? 'development-access-secret-change-me-0000',
    refreshTokenSecret: value.REFRESH_TOKEN_SECRET ?? 'development-refresh-secret-change-me-000',
    accessTokenTtlSeconds: value.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
    allowedWebOrigins,
    wsAllowedOrigins,
    devMockExternals: value.DEV_MOCK_EXTERNALS === 'true',
    devSmsCode: value.DEV_SMS_CODE,
    logLevel: value.LOG_LEVEL,
    maxBatchNodes: value.MAX_BATCH_NODES,
    maxBatchConnections: value.MAX_BATCH_CONNECTIONS,
    maxGenerationTasks: value.MAX_GENERATION_TASKS,
  };
}
