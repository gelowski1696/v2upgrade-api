import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './infrastructure/configuration/environment.js';
import { PrismaModule } from './infrastructure/database/prisma.module.js';
import { AuthModule } from './modules/auth.module.js';
import { AuditModule } from './modules/audit.module.js';
import { ClientsModule } from './modules/clients.module.js';
import { HealthModule } from './modules/health.module.js';
import { PlansModule } from './modules/plans.module.js';
import { SubscriptionsModule } from './modules/subscriptions.module.js';
import { DeviceSyncModule } from './modules/device-sync.module.js';
import { PortalModule } from './modules/portal.module.js';
import { AnalyticsModule } from './modules/analytics.module.js';
import { FinanceModule } from './modules/finance.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    ClientsModule,
    PlansModule,
    SubscriptionsModule,
    DeviceSyncModule,
    PortalModule,
    AnalyticsModule,
    FinanceModule,
  ],
})
export class AppModule {}
