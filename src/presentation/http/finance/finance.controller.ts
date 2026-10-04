import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FinanceService } from '../../../application/finance/finance.service.js';
import { BillingStatementsService } from '../../../application/finance/billing-statements.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreateExpenseDto,
  CreateGroupPaymentDto,
  CreatePaymentDto,
  BillingStatementPreviewQueryDto,
  FinanceListQueryDto,
  FinanceRangeQueryDto,
  SendBillingStatementDto,
  VoidPaymentDto,
} from './finance.dto.js';

@ApiTags('Subscription finance')
@ApiBearerAuth()
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly billingStatements: BillingStatementsService,
  ) {}

  @Get('overview')
  overview(@Query() query: FinanceRangeQueryDto) {
    return this.finance.overview(query);
  }

  @Get('expenses')
  expenses(@Query() query: FinanceListQueryDto) {
    return this.finance.expenses(query);
  }

  @Get('payments')
  payments(@Query() query: FinanceListQueryDto) {
    return this.finance.payments(query);
  }

  @Get('billing-statements/preview')
  @Roles('SUPER_ADMIN', 'ADMIN')
  billingStatementPreview(@Query() query: BillingStatementPreviewQueryDto) {
    return this.billingStatements.preview(query);
  }

  @Post('billing-statements/send')
  @Roles('SUPER_ADMIN', 'ADMIN')
  sendBillingStatement(
    @Body() input: SendBillingStatementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billingStatements.send(input, user.id);
  }

  @Post('payments')
  createPayment(
    @Body() input: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finance.createPayment(input, user.id);
  }

  @Post('payments/group')
  createGroupPayment(
    @Body() input: CreateGroupPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finance.createGroupPayment(input, user.id);
  }

  @Post('payments/:id/void')
  @Roles('SUPER_ADMIN', 'ADMIN')
  voidPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: VoidPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finance.voidPayment(id, input.reason, user.id);
  }

  @Post('expenses')
  @Roles('SUPER_ADMIN', 'ADMIN')
  createExpense(
    @Body() input: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finance.createExpense(input, user.id);
  }

  @Delete('expenses/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  deleteExpense(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finance.deleteExpense(id, user.id);
  }
}
