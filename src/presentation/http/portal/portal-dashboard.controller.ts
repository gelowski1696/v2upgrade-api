import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PortalDashboardService } from '../../../application/portal/portal-dashboard.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import {
  PortalActivityQueryDto,
  PortalCashFlowTransactionsQueryDto,
  PortalDateRangeDto,
  PortalInventoryForecastQueryDto,
  PortalPageQueryDto,
  PortalReportQueryDto,
  PortalSalesTrendQueryDto,
  PortalSalesTargetQueryDto,
  SavePortalViewDto,
  UpdatePortalOverviewPreferencesDto,
  UpdatePortalSalesTargetDto,
} from './portal-dashboard.dto.js';

@ApiTags('Owner portal dashboard')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalDashboardController {
  constructor(private readonly dashboard: PortalDashboardService) {}

  @Get('stores')
  stores(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.dashboard.listStores(user);
  }

  @Get('activity')
  activity(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Query() query: PortalActivityQueryDto,
  ) {
    return this.dashboard.activityLog(user, query);
  }

  @Get('preferences')
  preferences(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.dashboard.preferences(user);
  }

  @Put('preferences/overview')
  updateOverviewPreferences(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: UpdatePortalOverviewPreferencesDto,
  ) {
    return this.dashboard.updateOverviewPreferences(
      user,
      input.overviewMetrics,
    );
  }

  @Post('preferences/saved-views')
  saveView(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: SavePortalViewDto,
  ) {
    return this.dashboard.saveView(user, input);
  }

  @Delete('preferences/saved-views/:viewId')
  deleteSavedView(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('viewId') viewId: string,
  ) {
    return this.dashboard.deleteSavedView(user, viewId);
  }

  @Delete('preferences')
  resetPreferences(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.dashboard.resetPreferences(user);
  }

  @Get('business-overview')
  businessOverview(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.businessOverview(user, query);
  }

  @Post('alerts/:alertId/dismiss')
  dismissAlert(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('alertId') alertId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.dismissAlert(user, alertId, query);
  }

  @Get('stores/:storeId/sync-status')
  syncStatus(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
  ) {
    return this.dashboard.syncStatus(user, storeId);
  }

  @Get('stores/:storeId/report-capabilities')
  reportCapabilities(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
  ) {
    return this.dashboard.reportCapabilities(user, storeId);
  }

  @Get('stores/:storeId/reports/inventory-summary')
  inventorySummaryReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.inventorySummaryReport(user, storeId, query);
  }

  @Get('stores/:storeId/reports/financial')
  financialReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.financialReport(user, storeId, query);
  }

  @Get('stores/:storeId/reports/discounts')
  discountReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.discountReport(user, storeId, query);
  }

  @Get('stores/:storeId/reports/purchases')
  purchaseReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.purchaseReport(user, storeId, query);
  }

  @Get('stores/:storeId/reports/special-receipts')
  specialReceiptReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.specialReceiptReport(user, storeId, query);
  }

  @Get('stores/:storeId/reports/customers')
  customerReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.customerReport(user, storeId, query);
  }

  @Get('stores/:storeId/overview')
  overview(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.overview(user, storeId, query);
  }

  @Get('stores/:storeId/sales-trends')
  salesTrends(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalSalesTrendQueryDto,
  ) {
    return this.dashboard.salesTrends(user, storeId, query);
  }

  @Get('stores/:storeId/data-quality')
  dataQuality(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.dataQuality(user, storeId, query);
  }

  @Get('stores/:storeId/receivables-aging')
  receivablesAging(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.receivablesAging(user, storeId, query);
  }

  @Get('stores/:storeId/customers/:customerId/balance-history')
  customerBalanceHistory(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.dashboard.customerBalanceHistory(user, storeId, customerId);
  }

  @Get('stores/:storeId/customer-insights')
  customerInsights(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.customerInsights(user, storeId, query);
  }

  @Get('stores/:storeId/customers/:customerId/purchase-history')
  customerPurchaseHistory(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.customerPurchaseHistory(
      user,
      storeId,
      customerId,
      query,
    );
  }

  @Get('stores/:storeId/sales')
  sales(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.sales(user, storeId, query);
  }

  @Get('stores/:storeId/sales/:saleId')
  sale(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('saleId', ParseIntPipe) saleId: number,
  ) {
    return this.dashboard.saleDetails(user, storeId, saleId);
  }

  @Get('stores/:storeId/inventory')
  inventory(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.inventory(user, storeId, query);
  }

  @Get('stores/:storeId/inventory-forecast')
  inventoryForecast(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalInventoryForecastQueryDto,
  ) {
    return this.dashboard.inventoryForecast(user, storeId, query);
  }

  @Get('stores/:storeId/sales-targets')
  salesTargets(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalSalesTargetQueryDto,
  ) {
    return this.dashboard.salesTargetPerformance(user, storeId, query.month);
  }

  @Post('stores/:storeId/sales-targets')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  updateSalesTarget(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Body() input: UpdatePortalSalesTargetDto,
  ) {
    return this.dashboard.updateSalesTarget(user, storeId, input);
  }

  @Get('stores/:storeId/inventory/:itemId/history')
  inventoryHistory(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.inventoryHistory(user, storeId, itemId, query);
  }

  @Get('stores/:storeId/transfers')
  transfers(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.transfers(user, storeId, query);
  }

  @Get('stores/:storeId/transfers/:transferId')
  transferDetails(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('transferId', ParseIntPipe) transferId: number,
  ) {
    return this.dashboard.transferDetails(user, storeId, transferId);
  }

  @Get('stores/:storeId/restock-monitoring')
  restockMonitoring(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.restockMonitoring(user, storeId, query);
  }

  @Get('stores/:storeId/product-performance')
  productPerformance(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.productPerformance(user, storeId, query);
  }

  @Get('stores/:storeId/profitability')
  profitability(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.profitability(user, storeId, query);
  }

  @Get('stores/:storeId/payment-analysis')
  paymentAnalysis(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.paymentAnalysis(user, storeId, query);
  }

  @Get('stores/:storeId/customer-balances')
  balances(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalPageQueryDto,
  ) {
    return this.dashboard.customerBalances(user, storeId, query);
  }

  @Get('stores/:storeId/cash-flow')
  cashFlow(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalDateRangeDto,
  ) {
    return this.dashboard.cashFlow(user, storeId, query);
  }

  @Get('stores/:storeId/cash-flow/transactions')
  cashFlowTransactions(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Query() query: PortalCashFlowTransactionsQueryDto,
  ) {
    return this.dashboard.cashFlowTransactions(user, storeId, query);
  }

  @Get('stores/:storeId/exports/:report')
  exportReport(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('storeId') storeId: string,
    @Param('report') report: string,
    @Query() query: PortalReportQueryDto,
  ) {
    return this.dashboard.exportReport(user, storeId, report, query);
  }
}
