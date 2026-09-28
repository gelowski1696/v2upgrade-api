import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PortalService } from '../application/portal/portal.service.js';
import { PortalDashboardService } from '../application/portal/portal-dashboard.service.js';
import { PortalScheduledReportsService } from '../application/portal/portal-scheduled-reports.service.js';
import { Argon2PasswordHasher } from '../infrastructure/auth/argon2-password-hasher.js';
import { PortalJwtStrategy } from '../infrastructure/auth/portal-jwt.strategy.js';
import { DevicePortalController } from '../presentation/http/portal/device-portal.controller.js';
import { PortalAuthController } from '../presentation/http/portal/portal-auth.controller.js';
import { PortalAuthGuard } from '../presentation/http/portal/portal-auth.guard.js';
import { PortalDashboardController } from '../presentation/http/portal/portal-dashboard.controller.js';
import { PortalReportSchedulesController } from '../presentation/http/portal/portal-report-schedules.controller.js';
import { ResendWebhookController } from '../presentation/http/webhooks/resend-webhook.controller.js';
import { PortalMailerService } from '../infrastructure/email/portal-mailer.service.js';
import { DeviceSyncModule } from './device-sync.module.js';
import { StoreDatabaseModule } from './store-database.module.js';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    DeviceSyncModule,
    StoreDatabaseModule,
  ],
  controllers: [
    PortalAuthController,
    DevicePortalController,
    PortalDashboardController,
    PortalReportSchedulesController,
    ResendWebhookController,
  ],
  providers: [
    PortalService,
    PortalDashboardService,
    PortalScheduledReportsService,
    PortalMailerService,
    PortalJwtStrategy,
    PortalAuthGuard,
    Argon2PasswordHasher,
  ],
  exports: [PortalAuthGuard],
})
export class PortalModule {}
