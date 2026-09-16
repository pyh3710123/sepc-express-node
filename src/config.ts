import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1, 'HOST must not be empty').default('0.0.0.0'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT must be an integer between 0 and 65535')
    .refine((value) => Number(value) <= 65535, 'PORT must be an integer between 0 and 65535')
    .default('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default(''),
});

export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly corsOrigins: readonly string[];
}

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let parsedOrigin: URL;

      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new Error(
          `Invalid environment configuration: CORS_ORIGINS entry "${origin}" must be an HTTP or HTTPS origin`,
        );
      }

      if (
        !['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.pathname !== '/' ||
        parsedOrigin.search !== '' ||
        parsedOrigin.hash !== '' ||
        parsedOrigin.username !== '' ||
        parsedOrigin.password !== ''
      ) {
        throw new Error(
          `Invalid environment configuration: CORS_ORIGINS entry "${origin}" must be an HTTP or HTTPS origin`,
        );
      }

      return parsedOrigin.origin;
    });
}

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AppConfig {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: Number(parsed.data.PORT),
    logLevel: parsed.data.LOG_LEVEL,
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGINS),
  };
}
