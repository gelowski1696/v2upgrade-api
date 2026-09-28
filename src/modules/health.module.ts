import { Module } from '@nestjs/common';
import { HealthController } from '../presentation/http/health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
