import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DeviceEnrollmentService } from '../../../application/device-enrollment/device-enrollment.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from '../portal/current-portal-user.decorator.js';
import { PortalAuthGuard } from '../portal/portal-auth.guard.js';
import {
  ConsumeDeviceEnrollmentDto,
  CreateDeviceEnrollmentDto,
} from './device-enrollment.dto.js';

@ApiTags('Device enrollment')
@Controller()
export class DeviceEnrollmentController {
  constructor(private readonly enrollment: DeviceEnrollmentService) {}

  @Post('device-enrollments/consume')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  consume(@Body() input: ConsumeDeviceEnrollmentDto) {
    return this.enrollment.consume(input);
  }

  @Post('portal/stores/:storeId/device-enrollments')
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  create(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() input: CreateDeviceEnrollmentDto,
  ) {
    return this.enrollment.create(user, storeId, input);
  }

  @Get('portal/stores/:storeId/device-enrollments')
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  list(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.enrollment.list(user, storeId);
  }

  @Post('portal/stores/:storeId/device-enrollments/:enrollmentId/revoke')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  revoke(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    return this.enrollment.revoke(user, storeId, enrollmentId);
  }
}
