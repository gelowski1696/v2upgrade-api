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
import { PortalService } from '../../../application/portal/portal.service.js';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';
import { CurrentDevice } from '../device/current-device.decorator.js';
import { DeviceAuthGuard } from '../device/device-auth.guard.js';
import { CreatePortalInvitationDto } from './portal-auth.dto.js';

@ApiTags('Device portal access')
@ApiBearerAuth()
@UseGuards(DeviceAuthGuard)
@Controller('device-portal')
export class DevicePortalController {
  constructor(private readonly portal: PortalService) {}

  @Post('invitations')
  create(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: CreatePortalInvitationDto,
  ) {
    return this.portal.createInvitation(device, input);
  }

  @Get('users')
  list(@CurrentDevice() device: AuthenticatedDevice) {
    return this.portal.listUsers(device);
  }

  @Post('users/:userId/disable')
  @HttpCode(204)
  disable(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.portal.setUserStatus(device, userId, false);
  }

  @Post('users/:userId/enable')
  @HttpCode(204)
  enable(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.portal.setUserStatus(device, userId, true);
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(204)
  revoke(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.portal.revokeInvitation(device, invitationId);
  }

  @Post('users/:userId/password-reset')
  createPasswordReset(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.portal.createPasswordReset(device, userId);
  }
}
