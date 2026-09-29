import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebAnalyticsService } from '../../../application/analytics/web-analytics.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from '../portal/current-portal-user.decorator.js';
import { PortalAuthGuard } from '../portal/portal-auth.guard.js';
import { WebAnalyticsBatchDto } from './web-analytics.dto.js';

@ApiTags('Owner dashboard web analytics')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal/analytics')
export class WebAnalyticsController {
  constructor(private readonly analytics: WebAnalyticsService) {}

  @Get('configuration')
  configuration(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.analytics.configuration(user);
  }

  @Post('events')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  ingest(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: WebAnalyticsBatchDto,
    @Req() request: Request,
  ) {
    return this.analytics.ingest(user, input, request.get('user-agent'));
  }
}
