import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PortalScheduledReportsService } from '../../../application/portal/portal-scheduled-reports.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import {
  ConfirmPortalEmailDto,
  UpdatePortalReportScheduleDto,
} from './portal-report-schedules.dto.js';

@ApiTags('Owner portal scheduled reports')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal/report-schedules')
export class PortalReportSchedulesController {
  constructor(private readonly schedules: PortalScheduledReportsService) {}

  @Get()
  list(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.schedules.list(user);
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  update(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: UpdatePortalReportScheduleDto,
  ) {
    return this.schedules.update(user, input);
  }

  @Post('email-verification/request')
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  requestEmailVerification(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.schedules.requestEmailVerification(user);
  }

  @Post('email-verification/confirm')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  confirmEmailVerification(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: ConfirmPortalEmailDto,
  ) {
    return this.schedules.confirmEmailVerification(user, input.code);
  }
}
