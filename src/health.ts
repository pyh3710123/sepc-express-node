import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from './database';
import { CollaborationService } from './collaboration';
import { AppError } from './common';

@Controller()
export class HealthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CollaborationService) private readonly collaboration: CollaborationService,
  ) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

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
