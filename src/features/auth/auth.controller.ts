import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError, parse } from '../../common';
import { AuthGuard, bearer } from './auth.guard';
import { AuthService, type AuthedRequest } from './auth.service';

@Controller('api')
export class AuthController {
  /** 注入认证服务，处理登录、手机号绑定和凭证刷新。 */
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** 校验用户名和密码字段后执行密码登录。 */
  @Post('login/password')
  loginPassword(@Body() body: unknown): ReturnType<AuthService['loginPassword']> {
    const input = parse(
      z.object({ username: z.string().min(1).max(255), password: z.string().min(1).max(255) }),
      body,
    );
    return this.auth.loginPassword(input.username, input.password);
  }

  /** 校验手机号和验证码用途后发起短信发送。 */
  @Post('sms/send')
  sendSms(@Body() body: unknown): ReturnType<AuthService['sendSms']> {
    const input = parse(
      z.object({
        mobile: z.string().regex(/^1\d{10}$/),
        sendType: z.enum(['login_register', 'bind_phone']),
      }),
      body,
    );
    return this.auth.sendSms(input.mobile, input.sendType);
  }

  /** 校验手机号验证码并执行短信登录或自动注册。 */
  @Post('login/sms')
  loginSms(@Body() body: unknown): ReturnType<AuthService['loginSms']> {
    const input = parse(
      z.object({ mobile: z.string().regex(/^1\d{10}$/), captcha: z.string().regex(/^\d{6}$/) }),
      body,
    );
    return this.auth.loginSms(input.mobile, input.captcha);
  }

  /** 校验微信授权码；未配置供应商时返回明确的不可用错误。 */
  @Post('login/wechat')
  loginWechat(@Body() body: unknown): never {
    parse(z.object({ code: z.string().trim().min(1).max(2048) }).strict(), body);
    throw new AppError(503, '微信登录未配置');
  }

  /** 仅允许当前已登录用户为自己的账号绑定手机号。 */
  @Post('user/bindPhone')
  @UseGuards(AuthGuard)
  bindPhone(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AuthService['bindPhone']> {
    const input = parse(
      z.object({ mobile: z.string().regex(/^1\d{10}$/), captcha: z.string().regex(/^\d{6}$/) }),
      body,
    );
    return this.auth.bindPhone(request.auth, input.mobile, input.captcha);
  }

  /** 从 Authorization 头读取刷新令牌并轮换会话凭证。 */
  @Post('auth/refresh')
  refresh(@Headers('authorization') authorization?: string): ReturnType<AuthService['refresh']> {
    return this.auth.refresh(bearer(authorization));
  }
}
