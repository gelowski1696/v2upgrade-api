import { Module } from '@nestjs/common';
import { WebAnalyticsService } from '../application/analytics/web-analytics.service.js';
import { AdminWebAnalyticsService } from '../application/analytics/admin-web-analytics.service.js';
import { AdminWebAnalyticsController } from '../presentation/http/analytics/admin-web-analytics.controller.js';
import { WebAnalyticsController } from '../presentation/http/analytics/web-analytics.controller.js';
import { AuthModule } from './auth.module.js';
import { PortalModule } from './portal.module.js';

@Module({
  imports: [AuthModule, PortalModule],
  controllers: [WebAnalyticsController, AdminWebAnalyticsController],
  providers: [WebAnalyticsService, AdminWebAnalyticsService],
})
export class AnalyticsModule {}
