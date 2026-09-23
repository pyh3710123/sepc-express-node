import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { Database } from './database';
import { HealthController } from './health';
import { AuthController, AuthGuard, AuthService } from './auth';
import { CanvasController, CanvasService } from './canvas';
import { GenerationController, GenerationService } from './generation';
import { OtherController, OpenApiController } from './other';
import { CollaborationController, CollaborationService } from './collaboration';

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    Database,
    AuthService,
    AuthGuard,
    CanvasService,
    GenerationService,
    CollaborationService,
  ],
  controllers: [
    HealthController,
    AuthController,
    CanvasController,
    GenerationController,
    CollaborationController,
    OtherController,
    OpenApiController,
  ],
  exports: [
    APP_CONFIG,
    Database,
    AuthService,
    CanvasService,
    GenerationService,
    CollaborationService,
  ],
})
export class AppModule {}
