import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { Database } from './database';
import { AccountsController } from './features/accounts/accounts.controller';
import { AccountsService } from './features/accounts/accounts.service';
import { AssetsController } from './features/assets/assets.controller';
import { AssetsService } from './features/assets/assets.service';
import { AuthGuard, AuthService } from './features/auth';
import { AuthController } from './features/auth/auth.controller';
import { CanvasController } from './features/canvas/canvas.controller';
import { CanvasService } from './features/canvas/canvas.service';
import { CameraController } from './features/catalogs/camera.controller';
import { CameraService } from './features/catalogs/camera.service';
import { PromptsController } from './features/catalogs/prompts.controller';
import { PromptsService } from './features/catalogs/prompts.service';
import { StylesController } from './features/catalogs/styles.controller';
import { StylesService } from './features/catalogs/styles.service';
import { VoiceController } from './features/catalogs/voice.controller';
import { VoiceService } from './features/catalogs/voice.service';
import { CollaborationController } from './features/collaboration/collaboration.controller';
import { CollaborationService } from './features/collaboration/collaboration.service';
import { ContentController } from './features/content/content.controller';
import { ContentService } from './features/content/content.service';
import { CreditsController } from './features/credits/credits.controller';
import { CreditsService } from './features/credits/credits.service';
import { GenerationController } from './features/generation/generation.controller';
import { GenerationService } from './features/generation/generation.service';
import { FinanceController } from './features/finance/finance.controller';
import { FinanceService } from './features/finance/finance.service';
import { HealthController } from './features/health/health.controller';
import { HomeController } from './features/home/home.controller';
import { HomeService } from './features/home/home.service';
import { UnavailableIntegrationsController } from './features/integrations/unavailable.controller';
import { VolcAssetsController } from './features/integrations/volc-assets.controller';
import { VolcAssetsService } from './features/integrations/volc-assets.service';
import { LibraryController } from './features/library/library.controller';
import { LibraryService } from './features/library/library.service';
import { PermissionsController } from './features/permissions/permissions.controller';
import { PermissionsService } from './features/permissions/permissions.service';
import { OpusesController } from './features/public/opuses.controller';
import { OpusesService } from './features/public/opuses.service';
import { ActivitiesController } from './features/public/activities.controller';
import { ActivitiesService } from './features/public/activities.service';
import { ProjectsController } from './features/projects/projects.controller';
import { ProjectsService } from './features/projects/projects.service';
import { OpenApiController } from './features/system/openapi.controller';
import { ScriptsController } from './features/scripts/scripts.controller';
import { ScriptsService } from './features/scripts/scripts.service';
import { StatisticsController } from './features/statistics/statistics.controller';
import { StatisticsService } from './features/statistics/statistics.service';
import { SceneController } from './features/scene/scene.controller';
import { SceneService } from './features/scene/scene.service';
import { TeamsController } from './features/teams/teams.controller';
import { TeamsService } from './features/teams/teams.service';

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    Database,
    AuthService,
    AuthGuard,
    AccountsService,
    AssetsService,
    TeamsService,
    CreditsService,
    PermissionsService,
    OpusesService,
    ActivitiesService,
    LibraryService,
    ScriptsService,
    StatisticsService,
    SceneService,
    ProjectsService,
    CanvasService,
    CameraService,
    PromptsService,
    StylesService,
    VoiceService,
    VolcAssetsService,
    GenerationService,
    FinanceService,
    CollaborationService,
    ContentService,
    HomeService,
  ],
  controllers: [
    HealthController,
    AuthController,
    AccountsController,
    AssetsController,
    TeamsController,
    CreditsController,
    PermissionsController,
    OpusesController,
    ActivitiesController,
    LibraryController,
    ScriptsController,
    StatisticsController,
    SceneController,
    ProjectsController,
    CanvasController,
    CameraController,
    PromptsController,
    StylesController,
    VoiceController,
    GenerationController,
    FinanceController,
    CollaborationController,
    ContentController,
    HomeController,
    UnavailableIntegrationsController,
    VolcAssetsController,
    OpenApiController,
  ],
  exports: [
    APP_CONFIG,
    Database,
    AuthService,
    PermissionsService,
    ProjectsService,
    CanvasService,
    GenerationService,
    CollaborationService,
  ],
})
export class AppModule {}
