import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SubscriptionsService } from '../application/subscriptions/subscriptions.service.js';
import { SUBSCRIPTION_REPOSITORY } from '../domain/subscriptions/subscription.repository.js';
import { PrismaSubscriptionRepository } from '../infrastructure/subscriptions/prisma-subscription.repository.js';
import { SubscriptionsController } from '../presentation/http/subscriptions/subscriptions.controller.js';
import { LicensesController } from '../presentation/http/subscriptions/licenses.controller.js';
import { AuthModule } from './auth.module.js';
import { ClientsModule } from './clients.module.js';
import { PlansModule } from './plans.module.js';

@Module({
  imports: [AuthModule, ClientsModule, PlansModule, JwtModule.register({})],
  controllers: [SubscriptionsController, LicensesController],
  providers: [
    SubscriptionsService,
    {
      provide: SUBSCRIPTION_REPOSITORY,
      useClass: PrismaSubscriptionRepository,
    },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
