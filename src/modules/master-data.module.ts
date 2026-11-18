import { Module } from '@nestjs/common';
import { MasterDataReleasesService } from '../application/master-data/master-data-releases.service.js';
import { MasterDataReleasesController } from '../presentation/http/clients/master-data-releases.controller.js';
import { AuthModule } from './auth.module.js';
import { DeviceSyncModule } from './device-sync.module.js';
import { MasterDataDeliveryService } from '../application/master-data/master-data-delivery.service.js';
import { MasterDataDeliveryController } from '../presentation/http/master-data/master-data-delivery.controller.js';

@Module({
  imports: [AuthModule, DeviceSyncModule],
  controllers: [MasterDataReleasesController, MasterDataDeliveryController],
  providers: [MasterDataReleasesService, MasterDataDeliveryService],
  exports: [MasterDataReleasesService],
})
export class MasterDataModule {}
