import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DeviceSyncService } from '../application/device-sync/device-sync.service.js';
import { DeviceJwtStrategy } from '../infrastructure/auth/device-jwt.strategy.js';
import { DeviceAuthGuard } from '../presentation/http/device/device-auth.guard.js';
import { DeviceSyncController } from '../presentation/http/device-sync/device-sync.controller.js';
import { StoreDatabaseModule } from './store-database.module.js';

@Module({
  imports: [PassportModule, StoreDatabaseModule],
  controllers: [DeviceSyncController],
  providers: [DeviceSyncService, DeviceJwtStrategy, DeviceAuthGuard],
  exports: [DeviceAuthGuard],
})
export class DeviceSyncModule {}
