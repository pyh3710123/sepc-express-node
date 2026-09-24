import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth';
import { HomeService } from './home.service';

@Controller('api/home')
export class HomeController {
  /** 注入首页数据服务。 */
  constructor(@Inject(HomeService) private readonly home: HomeService) {}

  /** 返回登录后的首页初始化配置。 */
  @Get('init')
  @UseGuards(AuthGuard)
  init(): Promise<{ model_enabled: boolean }> {
    return this.home.init();
  }

  /** 返回首页当前展示的轮播列表。 */
  @Get('carousel')
  carousel(): ReturnType<HomeService['carousel']> {
    return this.home.carousel();
  }
}
