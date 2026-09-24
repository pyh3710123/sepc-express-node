import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from '../../database';
import { CollaborationService } from '../collaboration/collaboration.service';
import { AppError } from '../../common';

@Controller()
export class HealthController {
  /** 注入数据库和协作服务，以便就绪检查覆盖关键依赖。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CollaborationService) private readonly collaboration: CollaborationService,
  ) {}

  /** 返回进程存活状态，不探测外部依赖。 */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /** 检查数据库与 Redis 协作通道；任一不可用时返回 503。 */
  @Get('ready')
  async ready(): Promise<{ status: string }> {
    try {
      await this.db.query('SELECT 1');
      await this.collaboration.ping();
    } catch {
      throw new AppError(503, '依赖未就绪');
    }
    return { status: 'ok' };
  }
}
