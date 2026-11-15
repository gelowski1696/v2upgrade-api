import { Module } from '@nestjs/common';
import { MasterDataReleasesService } from '../application/master-data/master-data-releases.service.js';
import { MasterDataReleasesController } from '../presentation/http/clients/master-data-releases.controller.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [MasterDataReleasesController],
  providers: [MasterDataReleasesService],
})
export class MasterDataModule {}
