import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { Database } from './database';
import { AccountsController } from './features/accounts/accounts.controller';
import { AccountsService } from './features/accounts/accounts.service';
import { AuthGuard, AuthService } from './features/auth';
import { AuthController } from './features/auth/auth.controller';
import { CanvasController } from './features/canvas/canvas.controller';
import { CanvasService } from './features/canvas/canvas.service';
import { CollaborationController } from './features/collaboration/collaboration.controller';
import { CollaborationService } from './features/collaboration/collaboration.service';
import { CreditsController } from './features/credits/credits.controller';
import { CreditsService } from './features/credits/credits.service';
import { GenerationController } from './features/generation/generation.controller';
import { GenerationService } from './features/generation/generation.service';
import { HealthController } from './features/health/health.controller';
import { HomeController } from './features/home/home.controller';
import { HomeService } from './features/home/home.service';
import { UnavailableIntegrationsController } from './features/integrations/unavailable.controller';
import { ProjectsController } from './features/projects/projects.controller';
import { ProjectsService } from './features/projects/projects.service';
import { OpenApiController } from './features/system/openapi.controller';

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    Database,
    AuthService,
    AuthGuard,
    AccountsService,
    CreditsService,
    ProjectsService,
    CanvasService,
    GenerationService,
    CollaborationService,
    HomeService,
  ],
  controllers: [
    HealthController,
    AuthController,
    AccountsController,
    CreditsController,
    ProjectsController,
    CanvasController,
    GenerationController,
    CollaborationController,
    HomeController,
    UnavailableIntegrationsController,
    OpenApiController,
  ],
  exports: [
    APP_CONFIG,
    Database,
    AuthService,
    ProjectsService,
    CanvasService,
    GenerationService,
    CollaborationService,
  ],
})
export class AppModule {}
