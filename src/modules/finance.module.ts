import { Module } from '@nestjs/common';
import { FinanceService } from '../application/finance/finance.service.js';
import { BillingStatementDocumentService } from '../application/finance/billing-statement-document.service.js';
import { BillingStatementsService } from '../application/finance/billing-statements.service.js';
import { PortalMailerService } from '../infrastructure/email/portal-mailer.service.js';
import { FinanceController } from '../presentation/http/finance/finance.controller.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    BillingStatementsService,
    BillingStatementDocumentService,
    PortalMailerService,
  ],
})
export class FinanceModule {}
