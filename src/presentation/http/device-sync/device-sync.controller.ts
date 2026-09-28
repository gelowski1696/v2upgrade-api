import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DeviceSyncService } from '../../../application/device-sync/device-sync.service.js';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';
import { CurrentDevice } from '../device/current-device.decorator.js';
import { DeviceAuthGuard } from '../device/device-auth.guard.js';
import { CreateSyncSessionDto } from './device-sync.dto.js';

@ApiTags('Device synchronization')
@ApiBearerAuth()
@UseGuards(DeviceAuthGuard)
@Controller('device-sync')
export class DeviceSyncController {
  constructor(private readonly sync: DeviceSyncService) {}

  @Post('sessions')
  create(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: CreateSyncSessionDto,
  ) {
    return this.sync.createSession(device, input);
  }

  @Put('sessions/:sessionId/file')
  @ApiConsumes('application/octet-stream')
  upload(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Req() request: Request,
    @Headers('content-length') contentLength?: string,
  ) {
    return this.sync.upload(
      device,
      sessionId,
      request,
      contentLength ? Number(contentLength) : undefined,
    );
  }

  @Post('sessions/:sessionId/complete')
  @HttpCode(200)
  complete(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.sync.complete(device, sessionId);
  }

  @Get('sessions/:sessionId')
  get(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.sync.status(device, sessionId);
  }

  @Get('status')
  status(@CurrentDevice() device: AuthenticatedDevice) {
    return this.sync.status(device);
  }

  @Get('snapshots')
  snapshots(@CurrentDevice() device: AuthenticatedDevice) {
    return this.sync.listSnapshots(device);
  }

  @Post('snapshots/:snapshotId/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('snapshotId', new ParseUUIDPipe({ version: '4' }))
    snapshotId: string,
  ) {
    return this.sync.reactivateSnapshot(device, snapshotId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  cancel(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.sync.cancel(device, sessionId);
  }
}
