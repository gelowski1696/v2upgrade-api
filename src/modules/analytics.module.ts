import { Module } from '@nestjs/common';
import { WebAnalyticsService } from '../application/analytics/web-analytics.service.js';
import { WebAnalyticsController } from '../presentation/http/analytics/web-analytics.controller.js';
import { PortalModule } from './portal.module.js';

@Module({
  imports: [PortalModule],
  controllers: [WebAnalyticsController],
  providers: [WebAnalyticsService],
})
export class AnalyticsModule {}
