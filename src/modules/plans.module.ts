import { Module } from '@nestjs/common';
import { PlansService } from '../application/plans/plans.service.js';
import { PLAN_REPOSITORY } from '../domain/plans/plan.repository.js';
import { PrismaPlanRepository } from '../infrastructure/plans/prisma-plan.repository.js';
import { PlansController } from '../presentation/http/plans/plans.controller.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PlansController],
  providers: [
    PlansService,
    { provide: PLAN_REPOSITORY, useClass: PrismaPlanRepository },
  ],
  exports: [PlansService, PLAN_REPOSITORY],
})
export class PlansModule {}
