import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MasterDataDeliveryService } from '../../../application/master-data/master-data-delivery.service.js';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';
import { CurrentDevice } from '../device/current-device.decorator.js';
import { DeviceAuthGuard } from '../device/device-auth.guard.js';
import { AcknowledgeMasterDataReleaseDto } from './master-data-delivery.dto.js';

@ApiTags('Device master data')
@ApiBearerAuth()
@UseGuards(DeviceAuthGuard)
@Controller('master-data/releases')
export class MasterDataDeliveryController {
  constructor(private readonly delivery: MasterDataDeliveryService) {}

  @Get('current')
  current(@CurrentDevice() device: AuthenticatedDevice) {
    return this.delivery.current(device);
  }

  @Get(':releaseId/download')
  download(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ) {
    return this.delivery.download(device, releaseId);
  }

  @Post(':releaseId/acknowledgements')
  acknowledge(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() input: AcknowledgeMasterDataReleaseDto,
  ) {
    return this.delivery.acknowledge(device, releaseId, input);
  }
}
