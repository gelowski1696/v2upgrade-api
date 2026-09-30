import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminWebAnalyticsService } from '../../../application/analytics/admin-web-analytics.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminWebAnalyticsQueryDto } from './admin-web-analytics.dto.js';

@ApiTags('Subscription web analytics')
@ApiBearerAuth()
@Controller('admin/web-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminWebAnalyticsController {
  constructor(private readonly analytics: AdminWebAnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminWebAnalyticsQueryDto,
  ) {
    return this.analytics.overview(user, query);
  }
}
