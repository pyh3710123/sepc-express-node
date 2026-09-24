import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppError } from '../../common';
import { AuthGuard } from '../auth';

@Controller('api')
@UseGuards(AuthGuard)
export class UnavailableIntegrationsController {
  /** OSS 尚未配置时以明确的不可用错误响应。 */
  @Get('oss/sts')
  oss(): never {
    throw new AppError(503, 'OSS STS 服务未配置');
  }
  /** 上传登记尚未接入时返回服务不可用错误。 */
  @Post('upload/data')
  upload(): never {
    throw new AppError(503, 'OSS 上传登记服务未配置');
  }
  /** 工作流执行能力尚未接入时返回服务不可用错误。 */
  @Post('workflow/execute')
  workflow(): never {
    throw new AppError(503, '工作流执行服务尚未接入');
  }
  /** 支付服务尚未配置时返回服务不可用错误。 */
  @Post('order/create')
  order(): never {
    throw new AppError(503, '支付服务未配置');
  }
  /** 火山素材服务尚未接入时返回服务不可用错误。 */
  @Post('volc-asset/check')
  volc(): never {
    throw new AppError(503, '火山素材服务未配置');
  }
}
