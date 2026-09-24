import type {
  ArgumentsHost,
  ExceptionFilter,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { ZodError, type ZodType } from 'zod';

export class AppError extends Error {
  /** 创建可直接映射为 HTTP 状态码和统一响应体的业务错误。 */
  constructor(
    public readonly status: number,
    message: string,
    public readonly data: unknown = null,
    public readonly code = status,
  ) {
    super(message);
  }
}

/** 校验外部输入，并将不符合接口约束的值转换为统一参数错误。 */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      400,
      '请求参数无效',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  return result.data;
}

/** 为成功响应封装统一的接口外层结构。 */
export function ok<T>(data: T): { code: 200; message: 'ok'; data: T } {
  return { code: 200, message: 'ok', data };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  /** 将业务、参数和框架异常转换为统一 JSON 错误响应。 */
  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof AppError) {
      reply
        .status(error.status)
        .send({ code: error.code, message: error.message, data: error.data });
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send({ code: 400, message: '请求参数无效', data: null });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      reply.status(status).send({ code: status, message: error.message, data: null });
      return;
    }
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const status = error.statusCode;
      if (status === 400 || status === 413) {
        reply.status(status).send({
          code: status,
          message: status === 413 ? '请求体过大' : '请求参数无效',
          data: null,
        });
        return;
      }
    }
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Unhandled request error',
        error_type: error instanceof Error ? error.name : 'unknown',
      }),
    );
    reply.status(500).send({ code: 500, message: '服务器内部错误', data: null });
  }
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  /** 为普通接口结果补齐统一成功响应，同时保留健康检查和文档原始响应。 */
  intercept(
    context: ExecutionContext,
    next: { handle: () => Observable<unknown> },
  ): Observable<unknown> {
    const url = context.switchToHttp().getRequest<{ url: string }>().url.split('?')[0];
    if (['/health', '/ready', '/openapi.json'].includes(url)) return next.handle();
    return next
      .handle()
      .pipe(
        map((value) => (value && typeof value === 'object' && 'code' in value ? value : ok(value))),
      );
  }
}
