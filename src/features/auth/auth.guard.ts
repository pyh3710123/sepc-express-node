import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { AuthService, type AuthedRequest } from './auth.service';

/** 从 Authorization 请求头提取 Bearer 凭证；格式无效时按未登录处理。 */
export function bearer(header: string | undefined): string {
  const match = /^Bearer (\S+)$/i.exec(header ?? '');
  if (!match) throw new AppError(401, '未登录或登录已失效');
  return match[1];
}

@Injectable()
export class AuthGuard implements CanActivate {
  /** 注入认证服务，为 HTTP 请求加载已验证身份。 */
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** 从 Authorization 头解析令牌并写入请求身份上下文。 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    request.auth = await this.auth.authenticate(bearer(request.headers.authorization));
    return true;
  }
}
