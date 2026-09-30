import { Module } from '@nestjs/common';
import { FinanceService } from '../application/finance/finance.service.js';
import { FinanceController } from '../presentation/http/finance/finance.controller.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
