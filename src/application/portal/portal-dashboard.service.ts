import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import type { Prisma as PlatformPrisma } from '../../generated/prisma/client.js';
import type {
  Prisma,
  PrismaClient as StorePrismaClient,
} from '../../generated/store-prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorePrismaClientFactory } from '../../infrastructure/store-database/store-prisma-client.factory.js';

interface DateRange {
  from?: string;
  to?: string;
}

interface BackupOperationHealth {
  status?: 'RUNNING' | 'PASS' | 'FAIL';
  checkedAt?: string;
}

interface PlatformBackupHealth {
  platformBackup?: BackupOperationHealth;
  restoreDrill?: BackupOperationHealth;
}

export interface OwnerAlert {
  id: string;
  storeId: string;
  storeName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  type: 'SYNC' | 'INVENTORY' | 'RECEIVABLE' | 'DISCOUNT' | 'BACKUP';
  title: string;
  detail: string;
  dismissible: boolean;
  amount?: number;
  saleId?: number;
  reference?: string;
  saleDate?: string;
  discountPercent?: number;
}

interface ReportQuery extends DateRange {
  search?: string;
  status?: string;
  payment?: string;
  itemCode?: string;
  category?: string;
  stockStatus?: 'OUT_OF_STOCK' | 'CRITICAL' | 'HEALTHY';
  forecastDays?: number;
  risk?: InventoryForecastRisk;
  profitabilitySort?: ProfitabilitySort;
  customerSort?: CustomerInsightsSort;
}

interface PagedReportQuery extends ReportQuery {
  page: number;
  pageSize: number;
}

type PortalActivityAction =
  'SECURITY' | 'STORE_SYNC' | 'SETTINGS' | 'REPORTING' | 'BACKUP';

interface PortalActivityQuery extends DateRange {
  action?: PortalActivityAction;
  storeId?: string;
  page: number;
  pageSize: number;
}

type SalesTrendGrouping = 'day' | 'week' | 'month';

interface SalesTrendQuery extends DateRange {
  group?: SalesTrendGrouping;
}

interface TrendRow {
  bucket: string;
  grossSales: number;
  transactionCount: number;
  discounts: number;
  costOfGoods: number;
  salesMissingCostCount: number;
}

interface SalesAggregateSum {
  totalAmount: number | null;
  totalCost: number | null;
  discount: number | null;
  specialDiscount: number | null;
}

interface ReceivablesAgingRow {
  currentAmount: number;
  oneToThirtyAmount: number;
  thirtyOneToSixtyAmount: number;
  sixtyOneToNinetyAmount: number;
  overNinetyAmount: number;
  datedInvoiceCount: number;
  undatedAmount: number;
  undatedInvoiceCount: number;
}

interface CustomerBalanceTotalRow {
  total: number;
  customerCount: number;
}

type ExportReport =
  | 'sales'
  | 'inventory'
  | 'inventory-forecast'
  | 'profitability'
  | 'customer-insights'
  | 'transfers'
  | 'customer-balances'
  | 'cash-flow';
type CsvValue = string | number | null | undefined;

interface CsvDataset {
  headers: string[];
  rows: CsvValue[][];
}

interface CashFlowTotals {
  openingBalance: number;
  salesReceipts: number;
  creditCollections: number;
  capitalCashIn: number;
  cashReceived: number;
  pettyCashOut: number;
  salaryPaid: number;
  restockPayments: number;
  cashPaid: number;
  netCashFlow: number;
  closingBalance: number;
}

type CashFlowSource =
  | 'SALES_RECEIPTS'
  | 'CREDIT_COLLECTIONS'
  | 'CAPITAL_CASH_IN'
  | 'PETTY_CASH_OUT'
  | 'SALARY_PAID'
  | 'RESTOCK_PAYMENTS';

interface CashFlowTransactionsQuery extends DateRange {
  source: CashFlowSource;
  page: number;
  pageSize: number;
}

interface CashFlowTransactionRow {
  id: number;
  movementDate: string;
  reference: string;
  description: string;
  paymentMethod: string;
  notes: string;
  amount: number;
}

interface InventorySummaryRow {
  trackedItems: number;
  outOfStockItems: number;
  criticalItems: number;
  healthyItems: number;
  storeFill: number;
  storeEmpty: number;
  warehouseFill: number;
  warehouseEmpty: number;
  recordedValue: number;
  stockBearingItems: number;
  valuedItems: number;
  missingCostItems: number;
}

interface InventoryHistoryRow {
  id: number;
  movementDate: string;
  reference: string;
  quantity: number;
  origin: string;
  remarks: string;
  quantityBefore: number | null;
  quantityAfter: number | null;
}

interface InventoryPriceRow {
  itemId: number;
  refillPrice: number;
  nonRefillPrice: number;
}

type InventoryForecastRisk =
  'OUT_OF_STOCK' | 'REORDER_NOW' | 'WATCH' | 'HEALTHY' | 'NO_RECENT_SALES';

interface InventoryForecastQuery extends PagedReportQuery {
  forecastDays?: number;
  risk?: InventoryForecastRisk;
}

interface InventoryForecastSalesRow {
  itemCode: string;
  quantity: number;
  lastSoldAt: string;
}

interface InventoryForecastRecord {
  id: number;
  code: string;
  item: string;
  category: string;
  storeFill: number;
  warehouseFill: number;
  availableStock: number;
  alertLevel: number;
  recordedCost: number;
  salesQuantity: number;
  averageDailySales: number;
  daysRemaining: number | null;
  projectedDemand: number;
  suggestedReorder: number;
  estimatedReorderCost: number;
  lastSoldAt: string | null;
  risk: InventoryForecastRisk;
}

interface TransferDetailRow {
  id: number;
  reference: string;
  supplier: string;
  destination: string;
  type: string;
  totalQuantity: number;
  totalAmount: number;
  encoder: string;
  transferDate: string;
  status: string;
  restockPrice: number;
  notes: string;
  invoiceReference: string;
  confirmedAt: string;
  paidAt: string;
  paymentMethod: string;
  paymentReference: string;
  paymentStatus: string;
  driverId: number | null;
  driverName: string;
}

interface TransferLineDetailRow {
  id: number;
  itemCode: string;
  itemName: string;
  itemSize: string;
  unit: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

interface TransferPaymentDetailRow {
  id: number;
  kind: string;
  amount: number;
  method: string;
  reference: string;
  notes: string;
  paidAt: string;
  recordedBy: string;
}

interface RestockMonitoringRow {
  id: number;
  reference: string;
  supplier: string;
  transferDate: string;
  receiptStatus: string;
  paymentStatus: string;
  quantity: number;
  purchaseAmount: number;
  payments: number;
  refunds: number;
}

interface ProductPerformanceRow {
  itemCode: string;
  item: string;
  category: string;
  quantity: number;
  revenue: number;
  recordedCost: number;
  missingCostLines: number;
}

type ProfitabilitySort = 'PROFIT' | 'MARGIN' | 'REVENUE';

interface ProfitabilityQuery extends PagedReportQuery {
  profitabilitySort?: ProfitabilitySort;
}

interface ProfitabilitySourceRow extends ProductPerformanceRow {
  lineCount: number;
}

interface ProfitabilityRecord {
  itemCode: string;
  item: string;
  category: string;
  quantity: number;
  revenue: number;
  recordedCost: number;
  recordedGrossProfit: number;
  recordedMarginPercent: number;
  lineCount: number;
  missingCostLines: number;
  costCoveragePercent: number;
}

type CustomerInsightsSort = 'SPEND' | 'VISITS' | 'RECENT' | 'BALANCE';

interface CustomerInsightsQuery extends PagedReportQuery {
  customerSort?: CustomerInsightsSort;
}

interface CustomerInsightRow {
  id: number;
  name: string;
  contact: string;
  balance: number;
  status: string;
  visitCount: number;
  recordedSpend: number;
  averagePurchase: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
}

interface CustomerPurchaseHistoryQuery extends DateRange {
  page: number;
  pageSize: number;
}

interface CustomerPurchaseRow {
  id: number;
  saleDate: string;
  reference: string;
  payment: string;
  status: string;
  itemCount: number;
  totalAmount: number;
  tenderBalance: number;
}

interface PaymentChannelRow {
  channel: string;
  salesTotal: number;
  saleReceipts: number;
  creditCollections: number;
}

interface FeatureModRow {
  key: string;
  enabled: number;
}

interface InventorySummaryReportRow {
  itemCode: string;
  itemName: string;
  openingFilled: number;
  openingEmpty: number;
  deliveries: number;
  sales: number;
  refill: number;
  pullOut: number;
  defective: number;
  backload: number;
  actualFilled: number;
  actualEmpty: number;
}

interface FinancialProductReportRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemSize: string;
  isLpgItem: number;
  openingQuantity: number;
  openingUnitCost: number;
  deliveredQuantity: number;
  deliveredTotal: number;
  closingQuantity: number;
  salesQuantity: number;
  costOfGoods: number;
  salesTotal: number;
}

interface DiscountModuleRow {
  salesDate: string;
  reference: string;
  customer: string;
  cashier: string;
  regularDiscount: number;
  specialDiscount: number;
  totalDiscount: number;
}

interface PurchaseModuleRow {
  id: number;
  purchaseDate: string;
  reference: string;
  supplier: string;
  driver: string;
  purchaseType: string;
  totalQuantity: number;
  totalAmount: number;
}

interface SpecialReceiptModuleRow {
  salesId: number;
  salesDate: string;
  reference: string;
  customer: string;
  saleType: string;
  itemCount: number;
  totalAmount: number;
  paymentMethod: string;
  cashier: string;
}

interface CustomerModuleRow {
  salesId: number;
  salesDate: string;
  reference: string;
  customer: string;
  address: string;
  groupName: string;
  itemCount: number;
  totalAmount: number;
}

const DEFAULT_OVERVIEW_METRICS = [
  'GROSS_SALES',
  'RECORDED_GROSS_PROFIT',
  'CUSTOMER_BALANCE',
  'INVENTORY_ALERTS',
] as const;

const SAVED_VIEW_REPORTS = [
  'overview',
  'sales',
  'inventory',
  'inventory-forecast',
  'transfers',
  'balances',
  'cash-flow',
  'restocks',
  'products',
  'profitability',
  'payments',
  'business',
  'inventory-summary',
  'financial-report',
  'discount-report',
  'purchase-report',
  'special-receipts',
  'customer-report',
  'customer-insights',
] as const;

const PORTAL_ACTIVITY_ACTION_GROUPS: Record<PortalActivityAction, string[]> = {
  SECURITY: [
    'portal.account_activated',
    'portal.login_succeeded',
    'portal.logged_out',
    'portal.password_changed',
    'portal.password_reset_completed',
    'portal.session_revoked',
    'portal.other_sessions_revoked',
    'portal.email_verified',
    'portal.user_enabled',
    'portal.user_disabled',
  ],
  STORE_SYNC: ['sync.snapshot_activated', 'sync.snapshot_restored'],
  SETTINGS: [
    'portal.overview_preferences_updated',
    'portal.saved_view_saved',
    'portal.saved_view_deleted',
    'portal.preferences_reset',
    'portal.sales_target_updated',
    'portal.alert_dismissed',
  ],
  REPORTING: [
    'portal.report_schedule_enabled',
    'portal.report_schedule_disabled',
  ],
  BACKUP: [
    'backup.platform_passed',
    'backup.platform_failed',
    'backup.restore_drill_passed',
    'backup.restore_drill_failed',
  ],
};

const PORTAL_ACTIVITY_ACTIONS = Object.values(
  PORTAL_ACTIVITY_ACTION_GROUPS,
).flat();

type OverviewMetric = (typeof DEFAULT_OVERVIEW_METRICS)[number];
type SavedViewDatePreset =
  'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'CUSTOM';

interface SaveViewInput {
  name: string;
  report: string;
  storeId: string;
  datePreset: SavedViewDatePreset;
  dateFrom?: string;
  dateTo?: string;
  filters: Record<string, unknown>;
}

@Injectable()
export class PortalDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StorePrismaClientFactory,
    private readonly config: ConfigService,
  ) {}

  async listStores(user: AuthenticatedPortalUser) {
    return this.prisma.store.findMany({
      where: { id: { in: user.storeIds }, status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        activeSnapshot: {
          select: {
            schemaVersion: true,
            snapshotCreatedAt: true,
            activatedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async activityLog(user: AuthenticatedPortalUser, input: PortalActivityQuery) {
    const range = this.requiredDateRange(input);
    if (input.storeId) this.authorize(user, input.storeId);
    const stores = await this.prisma.store.findMany({
      where: { id: { in: user.storeIds }, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const storeIds = input.storeId
      ? [input.storeId]
      : stores.map((store) => store.id);
    const actions = input.action
      ? PORTAL_ACTIVITY_ACTION_GROUPS[input.action]
      : PORTAL_ACTIVITY_ACTIONS;
    const audience: PlatformPrisma.AuditLogWhereInput[] = input.storeId
      ? [
          {
            metadata: { path: ['storeId'], equals: input.storeId },
          },
        ]
      : [
          {
            AND: [
              { action: { startsWith: 'portal.' } },
              {
                OR: [
                  { resourceId: user.id },
                  {
                    metadata: { path: ['portalUserId'], equals: user.id },
                  },
                ],
              },
            ],
          },
          ...storeIds.map((storeId): PlatformPrisma.AuditLogWhereInput => ({
            AND: [
              { action: { startsWith: 'sync.' } },
              { metadata: { path: ['storeId'], equals: storeId } },
            ],
          })),
          { action: { startsWith: 'backup.' } },
        ];
    const where: PlatformPrisma.AuditLogWhereInput = {
      action: { in: actions },
      createdAt: {
        gte: new Date(`${range.from}T00:00:00.000Z`),
        lt: new Date(`${this.addDays(range.to, 1)}T00:00:00.000Z`),
      },
      OR: audience,
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const storeNames = new Map(stores.map((store) => [store.id, store.name]));
    return {
      items: rows.map((row) => this.portalActivityEvent(row, storeNames)),
      total,
      page: input.page,
      pageSize: input.pageSize,
      filterOptions: {
        actions: [
          { value: 'SECURITY', label: 'Security and access' },
          { value: 'STORE_SYNC', label: 'Store synchronization' },
          { value: 'SETTINGS', label: 'Portal settings' },
          { value: 'REPORTING', label: 'Scheduled reporting' },
          { value: 'BACKUP', label: 'Backup and recovery' },
        ],
        stores,
      },
    };
  }

  async preferences(user: AuthenticatedPortalUser) {
    const [preference, savedViews] = await Promise.all([
      this.prisma.portalDashboardPreference.findUnique({
        where: { portalUserId: user.id },
      }),
      this.prisma.portalSavedView.findMany({
        where: {
          portalUserId: user.id,
          storeId: { in: user.storeIds },
        },
        include: { store: { select: { name: true } } },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      }),
    ]);
    return {
      overviewMetrics: this.overviewMetrics(preference?.overviewMetrics),
      savedViews: savedViews.map((view) => ({
        id: view.id,
        name: view.name,
        report: view.report,
        storeId: view.storeId,
        storeName: view.store.name,
        datePreset: view.datePreset,
        dateFrom: view.dateFrom,
        dateTo: view.dateTo,
        filters: view.filters,
        updatedAt: view.updatedAt,
      })),
    };
  }

  async updateOverviewPreferences(
    user: AuthenticatedPortalUser,
    metrics: OverviewMetric[],
  ) {
    const overviewMetrics = this.overviewMetrics(metrics);
    await this.prisma.portalDashboardPreference.upsert({
      where: { portalUserId: user.id },
      create: { portalUserId: user.id, overviewMetrics },
      update: { overviewMetrics },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.overview_preferences_updated',
        resourceType: 'portal_dashboard_preference',
        resourceId: user.id,
        metadata: {
          portalUserId: user.id,
          metricCount: overviewMetrics.length,
        },
      },
    });
    return { overviewMetrics };
  }

  async saveView(user: AuthenticatedPortalUser, input: SaveViewInput) {
    this.authorize(user, input.storeId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Saved view name is required.');
    const report = this.savedViewReport(input.report);
    const customRange =
      input.datePreset === 'CUSTOM'
        ? this.requiredDateRange({ from: input.dateFrom, to: input.dateTo })
        : null;
    const filters = this.savedViewFilters(input.filters);
    const view = await this.prisma.portalSavedView.upsert({
      where: { portalUserId_name: { portalUserId: user.id, name } },
      create: {
        portalUserId: user.id,
        storeId: input.storeId,
        name,
        report,
        datePreset: input.datePreset,
        dateFrom: customRange?.from ?? null,
        dateTo: customRange?.to ?? null,
        filters,
      },
      update: {
        storeId: input.storeId,
        report,
        datePreset: input.datePreset,
        dateFrom: customRange?.from ?? null,
        dateTo: customRange?.to ?? null,
        filters,
      },
      include: { store: { select: { name: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.saved_view_saved',
        resourceType: 'portal_saved_view',
        resourceId: view.id,
        metadata: {
          portalUserId: user.id,
          storeId: view.storeId,
          viewName: view.name,
          report: view.report,
        },
      },
    });
    return {
      id: view.id,
      name: view.name,
      report: view.report,
      storeId: view.storeId,
      storeName: view.store.name,
      datePreset: view.datePreset,
      dateFrom: view.dateFrom,
      dateTo: view.dateTo,
      filters: view.filters,
      updatedAt: view.updatedAt,
    };
  }

  async deleteSavedView(user: AuthenticatedPortalUser, viewId: string) {
    const result = await this.prisma.portalSavedView.deleteMany({
      where: { id: viewId, portalUserId: user.id },
    });
    if (result.count === 0)
      throw new NotFoundException('Saved view was not found.');
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.saved_view_deleted',
        resourceType: 'portal_saved_view',
        resourceId: viewId,
        metadata: { portalUserId: user.id },
      },
    });
    return { id: viewId, deleted: true };
  }

  async resetPreferences(user: AuthenticatedPortalUser) {
    const removed = await this.prisma.portalSavedView.deleteMany({
      where: { portalUserId: user.id },
    });
    await this.prisma.portalDashboardPreference.deleteMany({
      where: { portalUserId: user.id },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.preferences_reset',
        resourceType: 'portal_dashboard_preference',
        resourceId: user.id,
        metadata: { portalUserId: user.id, savedViewsRemoved: removed.count },
      },
    });
    return {
      overviewMetrics: [...DEFAULT_OVERVIEW_METRICS],
      savedViews: [],
    };
  }

  async syncStatus(user: AuthenticatedPortalUser, storeId: string) {
    this.authorize(user, storeId);
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        timezone: true,
        activeSnapshot: {
          select: {
            id: true,
            schemaVersion: true,
            applicationVersion: true,
            snapshotCreatedAt: true,
            activatedAt: true,
          },
        },
      },
    });
    if (!store) throw new NotFoundException('Store was not found.');
    return store;
  }

  reportCapabilities(user: AuthenticatedPortalUser, storeId: string) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const subscriptionFeatures = await this.subscriptionFeatureMods(storeId);
      const hasSnapshotFeatures = await this.tableExists(
        db,
        'owner_feature_mods',
      );
      if (
        !hasSnapshotFeatures &&
        Object.keys(subscriptionFeatures).length === 0
      ) {
        return {
          available: false,
          reports: [],
        };
      }
      const rows = hasSnapshotFeatures
        ? await db.$queryRawUnsafe<FeatureModRow[]>(
            `SELECT feature_key AS key,
                CAST(enabled AS INTEGER) AS enabled
           FROM owner_feature_mods
          WHERE feature_key IN ('summaryCsv', 'financialReport', 'discountReport', 'purchases', 'specialReceipts', 'customerReport')
          ORDER BY feature_key`,
          )
        : [];
      const snapshotFeatures = Object.fromEntries(
        rows.map((row) => [row.key, Number(row.enabled) === 1]),
      );
      const reports = Object.entries({
        customerReport: 'customer-report',
        discountReport: 'discount-report',
        financialReport: 'financial-report',
        purchases: 'purchase-report',
        specialReceipts: 'special-receipts',
        summaryCsv: 'inventory-summary',
      })
        .filter(
          ([key]) =>
            subscriptionFeatures[key] ?? snapshotFeatures[key] ?? false,
        )
        .map(([, report]) => report)
        .filter(
          (report) => report !== 'financial-report' || user.role === 'OWNER',
        );
      return {
        available: true,
        reports,
      };
    });
  }

  discountReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    const dates = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(
        db,
        storeId,
        'discountReport',
        'Discount Report',
      );
      const sourceSql = `FROM salestbl
          WHERE salesdate >= ? AND salesdate < datetime(?, '+1 day')
            AND UPPER(COALESCE(salestatus, '')) <> 'CANCELLED'
            AND (CAST(COALESCE(salesdisc, 0) AS REAL) <> 0
                 OR CAST(COALESCE(specialdisc, 0) AS REAL) <> 0)`;
      const [rows, aggregateRows] = await Promise.all([
        db.$queryRawUnsafe<DiscountModuleRow[]>(
          `SELECT COALESCE(salesdate, '') AS salesDate,
                TRIM(COALESCE(salesrefnum, '')) AS reference,
                TRIM(COALESCE(salescust, 'Walk-in')) AS customer,
                TRIM(COALESCE(salescashier, '')) AS cashier,
                CAST(COALESCE(salesdisc, 0) AS REAL) AS regularDiscount,
                CAST(COALESCE(specialdisc, 0) AS REAL) AS specialDiscount,
                CAST(COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0) AS REAL) AS totalDiscount
           ${sourceSql}
          ORDER BY datetime(salesdate) DESC, salesid DESC
          LIMIT ? OFFSET ?`,
          dates.from,
          dates.to,
          input.pageSize,
          (input.page - 1) * input.pageSize,
        ),
        db.$queryRawUnsafe<Array<{ total: number; totalAmount: number }>>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS total,
                  CAST(COALESCE(SUM(COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0)), 0) AS REAL) AS totalAmount
             ${sourceSql}`,
          dates.from,
          dates.to,
        ),
      ]);
      const aggregate = aggregateRows[0];
      return {
        items: rows.map((row) => ({
          ...row,
          regularDiscount: this.amount(row.regularDiscount),
          specialDiscount: this.amount(row.specialDiscount),
          totalDiscount: this.amount(row.totalDiscount),
        })),
        total: Number(aggregate?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        totalAmount: this.amount(aggregate?.totalAmount),
      };
    });
  }

  purchaseReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    const dates = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(db, storeId, 'purchases', 'Purchase Report');
      const sourceSql = `FROM pouttbl transfer
           LEFT JOIN personeltbl personnel
             ON CAST(personnel.pid AS INTEGER) = CAST(COALESCE(transfer.poutpid, 0) AS INTEGER)
          WHERE transfer.pulldate >= ? AND transfer.pulldate < datetime(?, '+1 day')
            AND UPPER(TRIM(COALESCE(transfer.pouttype, ''))) IN ('RESTOCK IN', 'W.RESTOCK IN')
            AND UPPER(TRIM(COALESCE(transfer.pulloutremarks, ''))) = 'CONFIRMED'`;
      const [rows, aggregateRows] = await Promise.all([
        db.$queryRawUnsafe<PurchaseModuleRow[]>(
          `SELECT CAST(transfer.poutid AS INTEGER) AS id,
                transfer.pulldate AS purchaseDate,
                TRIM(COALESCE(transfer.poutrefnum, '')) AS reference,
                TRIM(COALESCE(transfer.pullsupplier, '')) AS supplier,
                TRIM(COALESCE(personnel.pname, '')) AS driver,
                UPPER(TRIM(COALESCE(transfer.pouttype, ''))) AS purchaseType,
                CAST(COALESCE(transfer.pouttotalqty, 0) AS INTEGER) AS totalQuantity,
                CAST(CASE WHEN COALESCE(transfer.restockprice, 0) > 0
                     THEN transfer.restockprice ELSE COALESCE(transfer.pouttotalamount, 0) END AS REAL) AS totalAmount
           ${sourceSql}
          ORDER BY datetime(transfer.pulldate) DESC, transfer.poutid DESC
          LIMIT ? OFFSET ?`,
          dates.from,
          dates.to,
          input.pageSize,
          (input.page - 1) * input.pageSize,
        ),
        db.$queryRawUnsafe<Array<{ total: number; totalAmount: number }>>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS total,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(transfer.restockprice, 0) > 0
                       THEN transfer.restockprice ELSE COALESCE(transfer.pouttotalamount, 0) END), 0) AS REAL) AS totalAmount
             ${sourceSql}`,
          dates.from,
          dates.to,
        ),
      ]);
      const aggregate = aggregateRows[0];
      return {
        items: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          totalQuantity: Number(row.totalQuantity),
          totalAmount: this.amount(row.totalAmount),
        })),
        total: Number(aggregate?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        totalAmount: this.amount(aggregate?.totalAmount),
      };
    });
  }

  specialReceiptReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    const dates = this.requiredDateRange(range);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(
        db,
        storeId,
        'specialReceipts',
        'Special Receipts',
      );
      const rows = await db.$queryRawUnsafe<SpecialReceiptModuleRow[]>(
        `SELECT CAST(salesid AS INTEGER) AS salesId,
                COALESCE(salesdate, '') AS salesDate,
                TRIM(COALESCE(salesrefnum, '')) AS reference,
                TRIM(COALESCE(salescust, 'Walk-in')) AS customer,
                TRIM(COALESCE(salescat, '')) AS saleType,
                CAST(COALESCE(salestotalitem, 0) AS INTEGER) AS itemCount,
                CAST(COALESCE(salestotalamount, 0) AS REAL) AS totalAmount,
                TRIM(COALESCE(salespaym, '')) AS paymentMethod,
                TRIM(COALESCE(salescashier, '')) AS cashier
           FROM salestbl
          WHERE salesdate >= ? AND salesdate < datetime(?, '+1 day')
            AND UPPER(COALESCE(spreceipt, 'N')) = 'Y'
            AND UPPER(COALESCE(salestatus, '')) <> 'CANCELLED'
          ORDER BY datetime(salesdate) DESC, salesid DESC
          LIMIT 500`,
        dates.from,
        dates.to,
      );
      return {
        items: rows.map((row) => ({
          ...row,
          salesId: Number(row.salesId),
          itemCount: Number(row.itemCount),
          totalAmount: this.amount(row.totalAmount),
        })),
        totalAmount: rows.reduce(
          (sum, row) => sum + this.amount(row.totalAmount),
          0,
        ),
      };
    });
  }

  customerReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    const dates = this.requiredDateRange(range);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(
        db,
        storeId,
        'customerReport',
        'Customer Report',
      );
      const rows = await db.$queryRawUnsafe<CustomerModuleRow[]>(
        `SELECT CAST(sales.salesid AS INTEGER) AS salesId,
                COALESCE(sales.salesdate, '') AS salesDate,
                TRIM(COALESCE(sales.salesrefnum, '')) AS reference,
                TRIM(COALESCE(sales.salescust, 'Walk-in')) AS customer,
                TRIM(COALESCE(sales.salescustadd, '')) AS address,
                TRIM(COALESCE(groups.name, 'Ungrouped')) AS groupName,
                CAST(COALESCE(sales.salestotalitem, 0) AS INTEGER) AS itemCount,
                CAST(COALESCE(sales.salestotalamount, 0) AS REAL) AS totalAmount
           FROM salestbl sales
           LEFT JOIN customer_group_members members
             ON members.customer_id = CAST(COALESCE(sales.salescustid, 0) AS INTEGER)
           LEFT JOIN customer_groups groups ON groups.group_id = members.group_id
          WHERE sales.salesdate >= ? AND sales.salesdate < datetime(?, '+1 day')
            AND UPPER(COALESCE(sales.salestatus, '')) <> 'CANCELLED'
          ORDER BY datetime(sales.salesdate) DESC, sales.salesid DESC
          LIMIT 500`,
        dates.from,
        dates.to,
      );
      return {
        items: rows.map((row) => ({
          ...row,
          salesId: Number(row.salesId),
          itemCount: Number(row.itemCount),
          totalAmount: this.amount(row.totalAmount),
        })),
        totalAmount: rows.reduce(
          (sum, row) => sum + this.amount(row.totalAmount),
          0,
        ),
      };
    });
  }

  inventorySummaryReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    const dates = this.requiredDateRange(range);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(db, storeId, 'summaryCsv', 'Summary CSV');
      const [openingRows, actualRows] = await Promise.all([
        db.$queryRawUnsafe<Array<{ snapshotDate: string }>>(
          "SELECT COALESCE(MAX(DATE(date)), '') AS snapshotDate FROM invetorycounttbl WHERE DATE(date) < DATE(?)",
          dates.from,
        ),
        db.$queryRawUnsafe<Array<{ snapshotDate: string }>>(
          "SELECT COALESCE(MAX(DATE(date)), '') AS snapshotDate FROM invetorycounttbl WHERE DATE(date) <= DATE(?)",
          dates.to,
        ),
      ]);
      const openingSnapshotDate = openingRows[0]?.snapshotDate ?? '';
      const actualSnapshotDate = actualRows[0]?.snapshotDate ?? '';
      if (!actualSnapshotDate) {
        return { openingSnapshotDate, actualSnapshotDate, rows: [] };
      }
      const rows = await db.$queryRawUnsafe<InventorySummaryReportRow[]>(
        `SELECT TRIM(COALESCE(inventory.itemcode, '')) AS itemCode,
                TRIM(COALESCE(inventory.itemname, '')) AS itemName,
                CAST(COALESCE(opening.fillqty, 0) AS INTEGER) AS openingFilled,
                CAST(COALESCE(opening.emptyqty, 0) AS INTEGER) AS openingEmpty,
                CAST(COALESCE(transfers.deliveries, 0) AS INTEGER) AS deliveries,
                CAST(COALESCE(sales.quantity, 0) AS INTEGER) AS sales,
                CAST(COALESCE(transfers.refill, 0) AS INTEGER) AS refill,
                CAST(COALESCE(transfers.pullOut, 0) AS INTEGER) AS pullOut,
                CAST(COALESCE(disposals.quantity, 0) AS INTEGER) AS defective,
                CAST(COALESCE(transfers.backload, 0) AS INTEGER) AS backload,
                CAST(COALESCE(actual.fillqty, 0) AS INTEGER) AS actualFilled,
                CAST(COALESCE(actual.emptyqty, 0) AS INTEGER) AS actualEmpty
           FROM inventorytbl inventory
           INNER JOIN categorytbl category ON category.category = inventory.itemcategory
           INNER JOIN invetorycounttbl actual
             ON actual.itemcode = inventory.itemcode AND DATE(actual.date) = DATE(?)
           LEFT JOIN invetorycounttbl opening
             ON opening.itemcode = inventory.itemcode AND DATE(opening.date) = DATE(?)
           LEFT JOIN (
              SELECT cart.poutitemcode AS itemCode,
                     SUM(CASE WHEN UPPER(TRIM(COALESCE(cart.pouttype, ''))) = 'RESTOCK INFILL' THEN cart.poutqty ELSE 0 END) AS deliveries,
                     SUM(CASE WHEN UPPER(TRIM(COALESCE(cart.pouttype, ''))) = 'RESTOCK OUTEMPTY' THEN cart.poutqty ELSE 0 END) AS refill,
                     SUM(CASE WHEN UPPER(TRIM(COALESCE(cart.pouttype, ''))) IN ('CONVERTEMPTY', 'PULL OUT') THEN cart.poutqty ELSE 0 END) AS pullOut,
                     SUM(CASE WHEN UPPER(TRIM(COALESCE(cart.pouttype, ''))) = 'RESTOCK OUTFILL' THEN cart.poutqty ELSE 0 END) AS backload
                FROM pulloutcart cart
                INNER JOIN pouttbl transfer ON transfer.poutrefnum = cart.poutref
               WHERE UPPER(TRIM(COALESCE(transfer.pulloutremarks, ''))) = 'CONFIRMED'
                 AND DATE(COALESCE(NULLIF(transfer.confirmed_at, ''), cart.poutdate)) BETWEEN DATE(?) AND DATE(?)
               GROUP BY cart.poutitemcode
           ) transfers ON transfers.itemCode = inventory.itemcode
           LEFT JOIN (
              SELECT history.itemhitemc AS itemCode, SUM(history.itemhqty) AS quantity
                FROM itemhistorytbl history
                INNER JOIN salescart cart
                  ON cart.screfnum = history.itemhrefnum AND cart.scitemcode = history.itemhitemc
                INNER JOIN salestbl sale ON sale.salesrefnum = cart.screfnum
               WHERE UPPER(TRIM(COALESCE(history.itemhorigin, ''))) IN ('PURCHASE ITEM', 'SCHEDULED DELIVERY')
                 AND UPPER(TRIM(COALESCE(cart.scstats, ''))) <> 'CANCELLED'
                 AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
                 AND DATE(history.itemhdate) BETWEEN DATE(?) AND DATE(?)
               GROUP BY history.itemhitemc
           ) sales ON sales.itemCode = inventory.itemcode
           LEFT JOIN (
              SELECT disitemcode AS itemCode, SUM(disqty) AS quantity
                FROM disposehistory
               WHERE UPPER(TRIM(COALESCE(disremarks, ''))) = 'DISPOSED'
                 AND DATE(disdate) BETWEEN DATE(?) AND DATE(?)
               GROUP BY disitemcode
           ) disposals ON disposals.itemCode = inventory.itemcode
          WHERE UPPER(TRIM(COALESCE(category.csv, 'N'))) = 'Y'
          ORDER BY category.catid, inventory.itemcode`,
        actualSnapshotDate,
        openingSnapshotDate,
        dates.from,
        dates.to,
        dates.from,
        dates.to,
        dates.from,
        dates.to,
      );
      return {
        openingSnapshotDate,
        actualSnapshotDate,
        rows: rows.map((row) => ({
          itemCode: row.itemCode,
          itemName: row.itemName,
          openingFilled: Number(row.openingFilled),
          openingEmpty: Number(row.openingEmpty),
          deliveries: Number(row.deliveries),
          sales: Number(row.sales),
          refill: Number(row.refill),
          pullOut: Number(row.pullOut),
          defective: Number(row.defective),
          backload: Number(row.backload),
          actualFilled: Number(row.actualFilled),
          actualEmpty: Number(row.actualEmpty),
        })),
      };
    });
  }

  financialReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    if (user.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only an owner can view the financial report.',
      );
    }
    const dates = this.requiredDateRange(range);
    return this.withFreshness(storeId, async (db) => {
      await this.requireFeatureMod(
        db,
        storeId,
        'financialReport',
        'Financial Report',
      );
      const [openingRows, actualRows, rows, cashFlow] = await Promise.all([
        db.$queryRawUnsafe<Array<{ snapshotDate: string }>>(
          "SELECT COALESCE(MAX(DATE(date)), '') AS snapshotDate FROM invetorycounttbl WHERE DATE(date) < DATE(?)",
          dates.from,
        ),
        db.$queryRawUnsafe<Array<{ snapshotDate: string }>>(
          "SELECT COALESCE(MAX(DATE(date)), '') AS snapshotDate FROM invetorycounttbl WHERE DATE(date) <= DATE(?)",
          dates.to,
        ),
        db.$queryRawUnsafe<FinancialProductReportRow[]>(
          `SELECT CAST(inventory.itemid AS INTEGER) AS itemId,
                  TRIM(COALESCE(inventory.itemcode, '')) AS itemCode,
                  TRIM(COALESCE(inventory.itemname, '')) AS itemName,
                  TRIM(COALESCE(inventory.itemsize, '')) AS itemSize,
                  CASE WHEN LOWER(TRIM(COALESCE(inventory.itemsize, ''))) NOT IN ('', '-', 'no size', 'no-size') THEN 1 ELSE 0 END AS isLpgItem,
                  CAST(COALESCE(opening.quantity, 0) AS INTEGER) AS openingQuantity,
                  CAST(COALESCE((
                    SELECT receipt.new_average_cost FROM inventory_cost_receipts receipt
                     WHERE receipt.itemid = inventory.itemid AND receipt.location = 'STORE'
                       AND receipt.unit = 'FULL' AND DATE(receipt.confirmed_at) < DATE(?)
                     ORDER BY datetime(receipt.confirmed_at) DESC, receipt.receipt_id DESC LIMIT 1
                  ), inventory.itemcost, 0) AS REAL) AS openingUnitCost,
                  CAST(COALESCE(delivery.quantity, 0) AS INTEGER) AS deliveredQuantity,
                  CAST(COALESCE(delivery.total, 0) AS REAL) AS deliveredTotal,
                  CAST(COALESCE(actual.quantity, 0) AS INTEGER) AS closingQuantity,
                  CAST(COALESCE(sales.quantity, 0) AS INTEGER) AS salesQuantity,
                  CAST(COALESCE(sales.totalCost, 0) AS REAL) AS costOfGoods,
                  CAST(COALESCE(sales.totalSales, 0) AS REAL) AS salesTotal
             FROM inventorytbl inventory
             LEFT JOIN (
                SELECT itemcode, SUM(CAST(COALESCE(fillqty, 0) AS INTEGER)) AS quantity
                  FROM invetorycounttbl WHERE DATE(date) = DATE((SELECT COALESCE(MAX(DATE(date)), '') FROM invetorycounttbl WHERE DATE(date) < DATE(?)))
                 GROUP BY itemcode
             ) opening ON opening.itemcode = inventory.itemcode
             LEFT JOIN (
                SELECT itemcode, SUM(CAST(COALESCE(fillqty, 0) AS INTEGER)) AS quantity
                  FROM invetorycounttbl WHERE DATE(date) = DATE((SELECT COALESCE(MAX(DATE(date)), '') FROM invetorycounttbl WHERE DATE(date) <= DATE(?)))
                 GROUP BY itemcode
             ) actual ON actual.itemcode = inventory.itemcode
             LEFT JOIN (
                SELECT itemcode, SUM(CAST(COALESCE(quantity, 0) AS INTEGER)) AS quantity,
                       SUM(CAST(COALESCE(line_total, 0) AS REAL)) AS total
                  FROM inventory_cost_receipts
                 WHERE location = 'STORE' AND unit = 'FULL'
                   AND DATE(confirmed_at) BETWEEN DATE(?) AND DATE(?)
                 GROUP BY itemcode
             ) delivery ON delivery.itemcode = inventory.itemcode
             LEFT JOIN (
                SELECT cart.scitemcode AS itemcode,
                       SUM(CAST(COALESCE(cart.scqty, 0) AS INTEGER)) AS quantity,
                       SUM(CAST(COALESCE(cart.totalcost, 0) AS REAL)) AS totalCost,
                       SUM(CAST(COALESCE(cart.sctotal, 0) AS REAL)) AS totalSales
                  FROM salescart cart INNER JOIN salestbl sale ON sale.salesrefnum = cart.screfnum
                 WHERE DATE(cart.scdate) BETWEEN DATE(?) AND DATE(?)
                   AND UPPER(TRIM(COALESCE(cart.scstats, ''))) <> 'CANCELLED'
                   AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
                 GROUP BY cart.scitemcode
             ) sales ON sales.itemcode = inventory.itemcode
            ORDER BY CASE WHEN LOWER(TRIM(COALESCE(inventory.itemsize, ''))) IN ('', '-', 'no size', 'no-size') THEN 1 ELSE 0 END,
                     inventory.itemname COLLATE NOCASE, inventory.itemcode COLLATE NOCASE`,
          dates.from,
          dates.from,
          dates.to,
          dates.from,
          dates.to,
          dates.from,
          dates.to,
        ),
        this.cashFlowTotals(db, dates),
      ]);
      const productRows = rows.map((row) => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        itemSize: row.itemSize,
        isLpgItem: Number(row.isLpgItem) === 1,
        openingQuantity: Number(row.openingQuantity),
        openingUnitCost: this.amount(row.openingUnitCost),
        openingTotal:
          Number(row.openingQuantity) * this.amount(row.openingUnitCost),
        deliveredQuantity: Number(row.deliveredQuantity),
        deliveredTotal: this.amount(row.deliveredTotal),
        closingQuantity: Number(row.closingQuantity),
        computedCogsQuantity: Math.max(
          0,
          Number(row.openingQuantity) +
            Number(row.deliveredQuantity) -
            Number(row.closingQuantity),
        ),
        costOfGoods: this.amount(row.costOfGoods),
        salesQuantity: Number(row.salesQuantity),
        salesTotal: this.amount(row.salesTotal),
      }));
      return {
        openingSnapshotDate: openingRows[0]?.snapshotDate ?? '',
        actualSnapshotDate: actualRows[0]?.snapshotDate ?? '',
        productRows,
        cashFlow,
      };
    });
  }

  async businessOverview(
    user: AuthenticatedPortalUser,
    range: DateRange,
    includeDismissed = false,
  ) {
    const dates = this.requiredDateRange(range);
    const stores = await this.prisma.store.findMany({
      where: { id: { in: user.storeIds }, status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        name: true,
        activeSnapshot: {
          select: {
            schemaVersion: true,
            snapshotCreatedAt: true,
            activatedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    const versions = stores
      .map((store) => store.activeSnapshot?.schemaVersion)
      .filter((version): version is number => Number.isInteger(version));
    const compatibleSchemaVersion = versions.length
      ? Math.max(...versions)
      : null;
    const now = Date.now();
    const staticAlerts = await this.backupHealthAlerts();
    const compatibleStores = stores.filter((store) => {
      if (!store.activeSnapshot) {
        staticAlerts.push({
          id: `sync-missing-${store.id}`,
          storeId: store.id,
          storeName: store.name,
          severity: 'HIGH',
          type: 'SYNC',
          title: 'Store has not synchronized',
          detail: 'No active database snapshot is available for reporting.',
          dismissible: false,
        });
        return false;
      }
      if (store.activeSnapshot.schemaVersion !== compatibleSchemaVersion) {
        staticAlerts.push({
          id: `schema-${store.id}`,
          storeId: store.id,
          storeName: store.name,
          severity: 'HIGH',
          type: 'SYNC',
          title: 'Store excluded from combined totals',
          detail: `Snapshot schema ${store.activeSnapshot.schemaVersion} differs from schema ${compatibleSchemaVersion}.`,
          dismissible: false,
        });
        return false;
      }
      return true;
    });
    const results = await Promise.allSettled(
      compatibleStores.map(async (store) => {
        const result = await this.stores.withClient(store.id, async (db) => {
          const [rows, cashFlow, highDiscountSales] = await Promise.all([
            db.$queryRawUnsafe<
              Array<{
                grossSales: number;
                transactionCount: number;
                recordedCost: number;
                missingCostSales: number;
                customerBalance: number;
                criticalItems: number;
                outOfStockItems: number;
                overdueBalance: number;
                overdueSaleCount: number;
              }>
            >(
              `SELECT
                 (SELECT CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) FROM salestbl WHERE date(salesdate) BETWEEN date(?) AND date(?) AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED') AS grossSales,
                 (SELECT CAST(COUNT(*) AS INTEGER) FROM salestbl WHERE date(salesdate) BETWEEN date(?) AND date(?) AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED') AS transactionCount,
                 (SELECT CAST(COALESCE(SUM(salestotalcost), 0) AS REAL) FROM salestbl WHERE date(salesdate) BETWEEN date(?) AND date(?) AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED') AS recordedCost,
                 (SELECT CAST(COALESCE(SUM(CASE WHEN COALESCE(salestotalamount, 0) > 0 AND (salestotalcost IS NULL OR salestotalcost <= 0) THEN 1 ELSE 0 END), 0) AS INTEGER) FROM salestbl WHERE date(salesdate) BETWEEN date(?) AND date(?) AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED') AS missingCostSales,
                 (SELECT CAST(COALESCE(SUM(CASE WHEN COALESCE(custbalance, 0) > 0 AND LOWER(TRIM(COALESCE(custstatus, 'active'))) <> 'inactive' THEN custbalance ELSE 0 END), 0) AS REAL) FROM custinfo) AS customerBalance,
                 (SELECT CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) > 0 AND COALESCE(alertnum, 0) > 0 AND fillqty <= alertnum THEN 1 ELSE 0 END), 0) AS INTEGER) FROM inventorytbl) AS criticalItems,
                 (SELECT CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) <= 0 THEN 1 ELSE 0 END), 0) AS INTEGER) FROM inventorytbl) AS outOfStockItems,
                 (SELECT CAST(COALESCE(SUM(MAX(0, COALESCE(tenderbalance, 0))), 0) AS REAL) FROM salestbl WHERE UPPER(TRIM(COALESCE(salestatus, ''))) = 'UNPAID' AND date(salesdate) < date(?, '-30 days')) AS overdueBalance,
                 (SELECT CAST(COUNT(*) AS INTEGER) FROM salestbl WHERE UPPER(TRIM(COALESCE(salestatus, ''))) = 'UNPAID' AND COALESCE(tenderbalance, 0) > 0 AND date(salesdate) < date(?, '-30 days')) AS overdueSaleCount`,
              dates.from,
              dates.to,
              dates.from,
              dates.to,
              dates.from,
              dates.to,
              dates.from,
              dates.to,
              dates.to,
              dates.to,
            ),
            this.cashFlowTotals(db, dates),
            db.$queryRawUnsafe<
              Array<{
                saleId: number;
                reference: string;
                saleDate: string;
                discountAmount: number;
                grossAmount: number;
                discountPercent: number;
              }>
            >(
              `SELECT CAST(salesid AS INTEGER) AS saleId,
                      TRIM(COALESCE(NULLIF(salesrefnum, ''), CAST(salesid AS TEXT))) AS reference,
                      COALESCE(salesdate, '') AS saleDate,
                      CAST(COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0) AS REAL) AS discountAmount,
                      CAST(COALESCE(salestotalamount, 0) + COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0) AS REAL) AS grossAmount,
                      CAST(ROUND(
                        (COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0)) * 100.0 /
                        NULLIF(COALESCE(salestotalamount, 0) + COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0), 0),
                        1
                      ) AS REAL) AS discountPercent
                 FROM salestbl
                WHERE date(salesdate) BETWEEN date(?) AND date(?)
                  AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
                  AND COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0) > 0
                  AND (COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0)) * 1.0 /
                      NULLIF(COALESCE(salestotalamount, 0) + COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0), 0) >= 0.20
                ORDER BY discountPercent DESC, discountAmount DESC, datetime(salesdate) DESC
                LIMIT 5`,
              dates.from,
              dates.to,
            ),
          ]);
          return { metrics: rows[0], cashFlow, highDiscountSales };
        });
        const metrics = result.data.metrics;
        const snapshotDate = store.activeSnapshot!.snapshotCreatedAt;
        const ageHours = Math.max(
          0,
          Math.floor((now - snapshotDate.getTime()) / 3_600_000),
        );
        return {
          id: store.id,
          code: store.code,
          name: store.name,
          schemaVersion: store.activeSnapshot!.schemaVersion,
          snapshotCreatedAt: snapshotDate,
          syncedAt: store.activeSnapshot!.activatedAt,
          ageHours,
          syncStatus: ageHours >= 24 ? 'STALE' : 'CURRENT',
          grossSales: this.amount(metrics?.grossSales),
          transactionCount: Number(metrics?.transactionCount ?? 0),
          recordedCost: this.amount(metrics?.recordedCost),
          recordedGrossProfit:
            this.amount(metrics?.grossSales) -
            this.amount(metrics?.recordedCost),
          missingCostSales: Number(metrics?.missingCostSales ?? 0),
          customerBalance: this.amount(metrics?.customerBalance),
          criticalItems: Number(metrics?.criticalItems ?? 0),
          outOfStockItems: Number(metrics?.outOfStockItems ?? 0),
          overdueBalance: this.amount(metrics?.overdueBalance),
          overdueSaleCount: Number(metrics?.overdueSaleCount ?? 0),
          highDiscountSaleCount: result.data.highDiscountSales.length,
          highDiscountSales: result.data.highDiscountSales.map((sale) => ({
            saleId: Number(sale.saleId),
            reference: sale.reference,
            saleDate: sale.saleDate,
            discountAmount: this.amount(sale.discountAmount),
            grossAmount: this.amount(sale.grossAmount),
            discountPercent: Number(sale.discountPercent),
          })),
          netCashFlow: result.data.cashFlow.netCashFlow,
        };
      }),
    );
    const storeRows: Array<Record<string, any>> = [];
    results.forEach((result, index) => {
      const store = compatibleStores[index];
      if (result.status === 'fulfilled') {
        storeRows.push(result.value);
      } else {
        staticAlerts.push({
          id: `sync-error-${store.id}`,
          storeId: store.id,
          storeName: store.name,
          severity: 'HIGH',
          type: 'SYNC',
          title: 'Store data could not be read',
          detail:
            'The active snapshot is unavailable or could not be validated.',
          dismissible: false,
        });
      }
    });
    const alerts = [...staticAlerts];
    for (const store of storeRows) {
      if (store.syncStatus === 'STALE')
        alerts.push({
          id: `stale-${store.id}-${new Date(store.snapshotCreatedAt).toISOString()}`,
          storeId: store.id,
          storeName: store.name,
          severity: store.ageHours >= 72 ? 'HIGH' : 'MEDIUM',
          type: 'SYNC',
          title: 'Synchronized data is stale',
          detail: `Last snapshot is ${store.ageHours} hours old.`,
          dismissible: store.ageHours < 72,
        });
      if (store.outOfStockItems > 0 || store.criticalItems > 0)
        alerts.push({
          id: `inventory-${store.id}-${store.outOfStockItems}-${store.criticalItems}`,
          storeId: store.id,
          storeName: store.name,
          severity: store.outOfStockItems > 0 ? 'HIGH' : 'MEDIUM',
          type: 'INVENTORY',
          title: 'Inventory requires attention',
          detail: `${store.outOfStockItems} out of stock and ${store.criticalItems} critical items.`,
          dismissible: store.outOfStockItems === 0,
        });
      if (store.overdueBalance > 0)
        alerts.push({
          id: `receivable-${store.id}-${store.overdueSaleCount}-${store.overdueBalance}`,
          storeId: store.id,
          storeName: store.name,
          severity: 'MEDIUM',
          type: 'RECEIVABLE',
          title: 'Overdue customer balances',
          detail: `${store.overdueSaleCount} sales older than 30 days remain unpaid.`,
          amount: store.overdueBalance,
          dismissible: true,
        });
      for (const sale of store.highDiscountSales)
        alerts.push({
          id: `discount-${store.id}-${sale.saleId}`,
          storeId: store.id,
          storeName: store.name,
          severity: sale.discountPercent >= 30 ? 'HIGH' : 'MEDIUM',
          type: 'DISCOUNT',
          title: 'High discount requires review',
          detail: `Sale ${sale.reference} was discounted ${sale.discountPercent.toFixed(1)}%, above the 20% review threshold.`,
          amount: sale.discountAmount,
          saleId: sale.saleId,
          reference: sale.reference,
          saleDate: sale.saleDate,
          discountPercent: sale.discountPercent,
          dismissible: sale.discountPercent < 30,
        });
    }
    const dismissibleAlertIds = alerts
      .filter((alert) => alert.dismissible)
      .map((alert) => alert.id);
    const dismissedAlertIds = new Set(
      !includeDismissed && dismissibleAlertIds.length
        ? (
            await this.prisma.portalAlertDismissal.findMany({
              where: {
                portalUserId: user.id,
                alertId: { in: dismissibleAlertIds },
              },
              select: { alertId: true },
            })
          ).map((dismissal) => dismissal.alertId)
        : [],
    );
    const visibleAlerts = alerts.filter(
      (alert) => !alert.dismissible || !dismissedAlertIds.has(alert.id),
    );
    const summary = storeRows.reduce(
      (total, store) => ({
        grossSales: total.grossSales + store.grossSales,
        transactionCount: total.transactionCount + store.transactionCount,
        recordedGrossProfit:
          total.recordedGrossProfit + store.recordedGrossProfit,
        customerBalance: total.customerBalance + store.customerBalance,
        netCashFlow: total.netCashFlow + store.netCashFlow,
        criticalItems: total.criticalItems + store.criticalItems,
        outOfStockItems: total.outOfStockItems + store.outOfStockItems,
      }),
      {
        grossSales: 0,
        transactionCount: 0,
        recordedGrossProfit: 0,
        customerBalance: 0,
        netCashFlow: 0,
        criticalItems: 0,
        outOfStockItems: 0,
      },
    );
    const generatedAt = new Date().toISOString();
    const oldestSnapshot = storeRows
      .map((store) => new Date(store.snapshotCreatedAt).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    return {
      storeId: 'ALL',
      snapshotId: 'MULTI_STORE',
      schemaVersion: compatibleSchemaVersion ?? 0,
      snapshotCreatedAt: oldestSnapshot
        ? new Date(oldestSnapshot).toISOString()
        : generatedAt,
      syncedAt: generatedAt,
      data: {
        generatedAt,
        compatibleSchemaVersion,
        authorizedStoreCount: stores.length,
        includedStoreCount: storeRows.length,
        excludedStoreCount: stores.length - storeRows.length,
        summary,
        stores: storeRows.map(({ highDiscountSales, ...store }) => store),
        alerts: visibleAlerts,
      },
    };
  }

  async dismissAlert(
    user: AuthenticatedPortalUser,
    alertId: string,
    range: DateRange,
  ) {
    const normalizedAlertId = alertId.trim();
    if (!normalizedAlertId || normalizedAlertId.length > 255) {
      throw new BadRequestException('A valid alert identifier is required.');
    }
    const overview = await this.businessOverview(user, range, true);
    const alert = overview.data.alerts.find(
      (candidate) => candidate.id === normalizedAlertId,
    );
    if (!alert) throw new NotFoundException('Alert was not found.');
    if (!alert.dismissible) {
      throw new BadRequestException(
        'High-severity alerts cannot be dismissed until the issue is resolved.',
      );
    }
    await this.prisma.portalAlertDismissal.upsert({
      where: {
        portalUserId_alertId: {
          portalUserId: user.id,
          alertId: normalizedAlertId,
        },
      },
      create: { portalUserId: user.id, alertId: normalizedAlertId },
      update: { dismissedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.alert_dismissed',
        resourceType: 'portal_alert',
        resourceId: normalizedAlertId,
        metadata: { portalUserId: user.id },
      },
    });
    return { alertId: normalizedAlertId, dismissed: true };
  }

  overview(user: AuthenticatedPortalUser, storeId: string, range: DateRange) {
    this.authorize(user, storeId);
    const dates = this.dateWhere(range);
    return this.withFreshness(storeId, async (db) => {
      const activeSale = {
        OR: [{ status: null }, { status: { not: 'CANCELLED' } }],
      };
      const [
        sales,
        transactionCount,
        salesMissingCostCount,
        inventoryCount,
        criticalCount,
        balances,
        transfers,
      ] = await Promise.all([
        db.sale.aggregate({
          where: { saleDate: dates, ...activeSale },
          _sum: {
            totalAmount: true,
            totalCost: true,
            discount: true,
            specialDiscount: true,
          },
        }),
        db.sale.count({ where: { saleDate: dates, ...activeSale } }),
        db.sale.count({
          where: {
            AND: [
              { saleDate: dates, ...activeSale },
              { totalAmount: { gt: 0 } },
              { OR: [{ totalCost: null }, { totalCost: { lte: 0 } }] },
            ],
          },
        }),
        db.inventoryItem.count(),
        db.inventoryItem.count({
          where: { fillQuantity: { lte: db.inventoryItem.fields.alertLevel } },
        }),
        db.customer.aggregate({
          where: {
            balance: { gt: 0 },
            OR: [{ status: null }, { status: { not: 'inactive' } }],
          },
          _sum: { balance: true },
          _count: true,
        }),
        db.transfer.count({ where: { transferDate: dates } }),
      ]);
      const grossSales = sales._sum.totalAmount ?? 0;
      const costOfGoods = sales._sum.totalCost ?? 0;
      const salesWithRecordedCost = Math.max(
        0,
        transactionCount - salesMissingCostCount,
      );
      return {
        transactionCount,
        salesWithRecordedCost,
        salesMissingCostCount,
        costCoveragePercent:
          transactionCount === 0
            ? 100
            : Math.round((salesWithRecordedCost / transactionCount) * 10_000) /
              100,
        profitDataComplete: salesMissingCostCount === 0,
        grossSales,
        discounts:
          (sales._sum.discount ?? 0) + (sales._sum.specialDiscount ?? 0),
        costOfGoods,
        grossProfit: grossSales - costOfGoods,
        customerBalance: balances._sum.balance ?? 0,
        customersWithBalance: balances._count,
        inventoryItems: inventoryCount,
        criticalItems: criticalCount,
        transfers,
      };
    });
  }

  async salesTargetPerformance(
    user: AuthenticatedPortalUser,
    storeId: string,
    month: string,
  ) {
    this.authorize(user, storeId);
    const period = this.salesTargetMonth(month);
    const [target, store, performance] = await Promise.all([
      this.prisma.portalSalesTarget.findUnique({
        where: { storeId_month: { storeId, month: period.month } },
      }),
      this.prisma.store.findFirst({
        where: { id: storeId, status: 'ACTIVE' },
        select: { timezone: true },
      }),
      this.overview(user, storeId, { from: period.from, to: period.to }),
    ]);
    if (!store) throw new NotFoundException('Store was not found.');

    const salesTarget = Number(target?.salesTarget ?? 0);
    const recordedGrossProfitTarget = Number(
      target?.recordedGrossProfitTarget ?? 0,
    );
    const actual = performance.data as {
      grossSales: number;
      grossProfit: number;
      transactionCount: number;
      costCoveragePercent: number;
      profitDataComplete: boolean;
      salesMissingCostCount: number;
    };
    const pace = this.salesTargetPace(
      period,
      store.timezone || 'Asia/Manila',
      actual.grossSales,
      actual.grossProfit,
      salesTarget,
      recordedGrossProfitTarget,
    );
    return {
      ...performance,
      data: {
        month: period.month,
        from: period.from,
        to: period.to,
        canEdit: user.role !== 'VIEWER',
        target: {
          configured: Boolean(target),
          sales: salesTarget,
          recordedGrossProfit: recordedGrossProfitTarget,
          updatedAt: target?.updatedAt?.toISOString() ?? null,
        },
        actual: {
          grossSales: actual.grossSales,
          recordedGrossProfit: actual.grossProfit,
          transactionCount: actual.transactionCount,
          costCoveragePercent: actual.costCoveragePercent,
          profitDataComplete: actual.profitDataComplete,
          missingCostSales: actual.salesMissingCostCount,
        },
        progress: {
          salesPercent: this.targetProgress(actual.grossSales, salesTarget),
          recordedGrossProfitPercent: this.targetProgress(
            actual.grossProfit,
            recordedGrossProfitTarget,
          ),
        },
        pace,
      },
    };
  }

  async updateSalesTarget(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: {
      month: string;
      salesTarget: number;
      recordedGrossProfitTarget: number;
    },
  ) {
    this.authorize(user, storeId);
    if (user.role === 'VIEWER') {
      throw new ForbiddenException(
        'Only an owner or manager can update sales targets.',
      );
    }
    const period = this.salesTargetMonth(input.month);
    const salesTarget = this.validTargetAmount(
      input.salesTarget,
      'Sales target',
    );
    const recordedGrossProfitTarget = this.validTargetAmount(
      input.recordedGrossProfitTarget,
      'Recorded gross profit target',
    );
    await this.prisma.portalSalesTarget.upsert({
      where: { storeId_month: { storeId, month: period.month } },
      create: {
        storeId,
        month: period.month,
        salesTarget,
        recordedGrossProfitTarget,
        updatedByPortalUserId: user.id,
      },
      update: {
        salesTarget,
        recordedGrossProfitTarget,
        updatedByPortalUserId: user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.sales_target_updated',
        resourceType: 'portal_sales_target',
        resourceId: `${storeId}:${period.month}`,
        metadata: {
          portalUserId: user.id,
          storeId,
          month: period.month,
        },
      },
    });
    return this.salesTargetPerformance(user, storeId, period.month);
  }

  dataQuality(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    const range = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      const [saleColumns, lineColumns, migrationTableExists, userVersionRows] =
        await Promise.all([
          this.tableColumns(db, 'salestbl'),
          this.tableColumns(db, 'salescart'),
          this.tableExists(db, 'schema_migrations'),
          db.$queryRawUnsafe<Array<{ user_version: number }>>(
            'PRAGMA user_version',
          ),
        ]);
      const requiredSaleColumns = [
        'salesid',
        'salesrefnum',
        'salescust',
        'salesdate',
        'salestatus',
        'salestotalamount',
        'salestotalcost',
      ];
      const requiredLineColumns = ['scid', 'screfnum', 'scstats', 'totalcost'];
      const missingColumns = [
        ...requiredSaleColumns
          .filter((column) => !saleColumns.has(column))
          .map((column) => `salestbl.${column}`),
        ...requiredLineColumns
          .filter((column) => !lineColumns.has(column))
          .map((column) => `salescart.${column}`),
      ];
      const userVersion = Number(userVersionRows[0]?.user_version ?? 0);
      const migrationRows = migrationTableExists
        ? await db.$queryRawUnsafe<Array<{ version: number }>>(
            'SELECT CAST(COALESCE(MAX(version), 0) AS INTEGER) AS version FROM schema_migrations',
          )
        : [];
      const migrationVersion = migrationTableExists
        ? Number(migrationRows[0]?.version ?? 0)
        : null;
      const issues = missingColumns.map(
        (column) => `Required cost field ${column} is unavailable.`,
      );
      let compatibility: 'COMPATIBLE' | 'PARTIAL' | 'INCOMPATIBLE' =
        missingColumns.length ? 'INCOMPATIBLE' : 'COMPATIBLE';
      if (!missingColumns.length && !migrationTableExists) {
        compatibility = 'PARTIAL';
        issues.push('The snapshot does not contain migration history.');
      } else if (
        !missingColumns.length &&
        (migrationVersion === 0 || userVersion === 0)
      ) {
        compatibility = 'PARTIAL';
        issues.push('The snapshot schema-version metadata is incomplete.');
      } else if (
        !missingColumns.length &&
        migrationVersion !== null &&
        migrationVersion !== userVersion
      ) {
        compatibility = 'PARTIAL';
        issues.push(
          `Migration version ${migrationVersion} does not match SQLite user version ${userVersion}.`,
        );
      }
      const empty = {
        compatibility: {
          status: compatibility,
          databaseSchemaVersion: userVersion,
          migrationVersion,
          issues,
        },
        summary: {
          totalSales: 0,
          salesWithRecordedCost: 0,
          missingCostSales: 0,
          legacyMissingCostSales: 0,
          unexpectedMissingCostSales: 0,
          costCoveragePercent: 100,
        },
        periods: [],
        items: [],
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
      };
      if (compatibility === 'INCOMPATIBLE') return empty;

      const qualitySql = `
        SELECT CAST(sale.salesid AS INTEGER) AS id,
               TRIM(COALESCE(sale.salesrefnum, '')) AS reference,
               COALESCE(sale.salesdate, '') AS saleDate,
               COALESCE(NULLIF(TRIM(sale.salescust), ''), 'Walk-in customer') AS customer,
               CAST(COALESCE(sale.salestotalamount, 0) AS REAL) AS totalAmount,
               COUNT(line.scid) AS lineCount,
               CAST(COALESCE(SUM(CASE WHEN COALESCE(line.totalcost, 0) > 0 THEN line.totalcost ELSE 0 END), 0) AS REAL) AS recordedLineCost
          FROM salestbl sale
          LEFT JOIN salescart line
            ON line.screfnum = sale.salesrefnum
           AND UPPER(TRIM(COALESCE(line.scstats, ''))) <> 'CANCELLED'
         WHERE date(sale.salesdate) BETWEEN date(?) AND date(?)
           AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
           AND COALESCE(sale.salestotalamount, 0) > 0
           AND (sale.salestotalcost IS NULL OR sale.salestotalcost <= 0)
         GROUP BY sale.salesid, sale.salesrefnum, sale.salesdate, sale.salescust, sale.salestotalamount`;
      const offset = (input.page - 1) * input.pageSize;
      const [totalRows, summaryRows, periodRows, itemRows] = await Promise.all([
        db.$queryRawUnsafe<Array<{ totalSales: number }>>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS totalSales
             FROM salestbl
            WHERE date(salesdate) BETWEEN date(?) AND date(?)
              AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'`,
          range.from,
          range.to,
        ),
        db.$queryRawUnsafe<
          Array<{
            missingCostSales: number;
            legacyMissingCostSales: number;
            unexpectedMissingCostSales: number;
          }>
        >(
          `SELECT CAST(COUNT(*) AS INTEGER) AS missingCostSales,
                  CAST(COALESCE(SUM(CASE WHEN recordedLineCost > 0 THEN 0 ELSE 1 END), 0) AS INTEGER) AS legacyMissingCostSales,
                  CAST(COALESCE(SUM(CASE WHEN recordedLineCost > 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS unexpectedMissingCostSales
             FROM (${qualitySql}) quality`,
          range.from,
          range.to,
        ),
        db.$queryRawUnsafe<
          Array<{
            period: string;
            missingCostSales: number;
            legacyMissingCostSales: number;
            unexpectedMissingCostSales: number;
          }>
        >(
          `SELECT strftime('%Y-%m', saleDate) AS period,
                  CAST(COUNT(*) AS INTEGER) AS missingCostSales,
                  CAST(COALESCE(SUM(CASE WHEN recordedLineCost > 0 THEN 0 ELSE 1 END), 0) AS INTEGER) AS legacyMissingCostSales,
                  CAST(COALESCE(SUM(CASE WHEN recordedLineCost > 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS unexpectedMissingCostSales
             FROM (${qualitySql}) quality
            GROUP BY period
            ORDER BY period DESC`,
          range.from,
          range.to,
        ),
        db.$queryRawUnsafe<
          Array<{
            id: number;
            reference: string;
            saleDate: string;
            customer: string;
            totalAmount: number;
            lineCount: number;
            recordedLineCost: number;
          }>
        >(
          `SELECT * FROM (${qualitySql}) quality
            ORDER BY datetime(saleDate) DESC, id DESC
            LIMIT ? OFFSET ?`,
          range.from,
          range.to,
          input.pageSize,
          offset,
        ),
      ]);
      const totalSales = Number(totalRows[0]?.totalSales ?? 0);
      const missingCostSales = Number(summaryRows[0]?.missingCostSales ?? 0);
      return {
        ...empty,
        summary: {
          totalSales,
          salesWithRecordedCost: Math.max(0, totalSales - missingCostSales),
          missingCostSales,
          legacyMissingCostSales: Number(
            summaryRows[0]?.legacyMissingCostSales ?? 0,
          ),
          unexpectedMissingCostSales: Number(
            summaryRows[0]?.unexpectedMissingCostSales ?? 0,
          ),
          costCoveragePercent:
            totalSales === 0
              ? 100
              : Math.round(
                  ((totalSales - missingCostSales) / totalSales) * 10_000,
                ) / 100,
        },
        periods: periodRows.map((row) => ({
          period: row.period,
          missingCostSales: Number(row.missingCostSales),
          legacyMissingCostSales: Number(row.legacyMissingCostSales),
          unexpectedMissingCostSales: Number(row.unexpectedMissingCostSales),
        })),
        items: itemRows.map((row) => ({
          ...row,
          id: Number(row.id),
          totalAmount: this.amount(row.totalAmount),
          lineCount: Number(row.lineCount),
          recordedLineCost: this.amount(row.recordedLineCost),
          classification:
            Number(row.recordedLineCost) > 0 ? 'UNEXPECTED' : 'LEGACY',
        })),
        total: missingCostSales,
      };
    });
  }

  salesTrends(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: SalesTrendQuery,
  ) {
    this.authorize(user, storeId);
    const range = this.requiredDateRange(input);
    const grouping = input.group ?? 'day';
    const previous = this.previousDateRange(range.from, range.to);
    return this.withFreshness(storeId, async (db) => {
      const activeSale = {
        OR: [{ status: null }, { status: { not: 'CANCELLED' } }],
      };
      const currentDates = this.dateWhere(range);
      const previousDates = this.dateWhere(previous);
      const [
        currentSales,
        currentCount,
        currentMissingCost,
        previousSales,
        previousCount,
        previousMissingCost,
        trendRows,
      ] = await Promise.all([
        db.sale.aggregate({
          where: { saleDate: currentDates, ...activeSale },
          _sum: {
            totalAmount: true,
            totalCost: true,
            discount: true,
            specialDiscount: true,
          },
        }),
        db.sale.count({ where: { saleDate: currentDates, ...activeSale } }),
        db.sale.count({
          where: {
            AND: [
              { saleDate: currentDates, ...activeSale },
              { totalAmount: { gt: 0 } },
              { OR: [{ totalCost: null }, { totalCost: { lte: 0 } }] },
            ],
          },
        }),
        db.sale.aggregate({
          where: { saleDate: previousDates, ...activeSale },
          _sum: {
            totalAmount: true,
            totalCost: true,
            discount: true,
            specialDiscount: true,
          },
        }),
        db.sale.count({ where: { saleDate: previousDates, ...activeSale } }),
        db.sale.count({
          where: {
            AND: [
              { saleDate: previousDates, ...activeSale },
              { totalAmount: { gt: 0 } },
              { OR: [{ totalCost: null }, { totalCost: { lte: 0 } }] },
            ],
          },
        }),
        this.trendRows(db, range.from, range.to, grouping),
      ]);

      return {
        grouping,
        current: this.salesPeriodMetrics(
          range,
          currentSales._sum,
          currentCount,
          currentMissingCost,
        ),
        previous: this.salesPeriodMetrics(
          previous,
          previousSales._sum,
          previousCount,
          previousMissingCost,
        ),
        points: this.fillTrendPoints(range.from, range.to, grouping, trendRows),
      };
    });
  }

  receivablesAging(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: DateRange,
  ) {
    this.authorize(user, storeId);
    const asOf = input.to?.slice(0, 10) || this.dateKey(new Date());
    return this.withFreshness(storeId, async (db) => {
      const [agingRows, customerTotalRows, highestBalances, recentCollections] =
        await Promise.all([
          db.$queryRawUnsafe<ReceivablesAgingRow[]>(
            `SELECT
               CAST(COALESCE(SUM(CASE WHEN age_days <= 0 THEN balance ELSE 0 END), 0) AS REAL) AS currentAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days BETWEEN 1 AND 30 THEN balance ELSE 0 END), 0) AS REAL) AS oneToThirtyAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN balance ELSE 0 END), 0) AS REAL) AS thirtyOneToSixtyAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN balance ELSE 0 END), 0) AS REAL) AS sixtyOneToNinetyAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days > 90 THEN balance ELSE 0 END), 0) AS REAL) AS overNinetyAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days IS NOT NULL THEN 1 ELSE 0 END), 0) AS INTEGER) AS datedInvoiceCount,
               CAST(COALESCE(SUM(CASE WHEN age_days IS NULL THEN balance ELSE 0 END), 0) AS REAL) AS undatedAmount,
               CAST(COALESCE(SUM(CASE WHEN age_days IS NULL THEN 1 ELSE 0 END), 0) AS INTEGER) AS undatedInvoiceCount
             FROM (
               SELECT CAST(COALESCE(s.tenderbalance, 0) AS REAL) AS balance,
                      CASE WHEN date(s.salesdate) IS NULL THEN NULL
                           ELSE CAST(julianday(date(?)) - julianday(date(s.salesdate)) AS INTEGER)
                      END AS age_days
                 FROM salestbl s
                 INNER JOIN custinfo c ON c.custid = s.salescustid
                WHERE COALESCE(c.custstatus, 'active') <> 'inactive' COLLATE NOCASE
                  AND UPPER(TRIM(COALESCE(s.salestatus, ''))) = 'UNPAID'
                  AND CAST(COALESCE(s.tenderbalance, 0) AS REAL) > 0
             ) invoices`,
            asOf,
          ),
          db.$queryRawUnsafe<CustomerBalanceTotalRow[]>(
            `SELECT CAST(COALESCE(SUM(custbalance), 0) AS REAL) AS total,
                    CAST(COUNT(*) AS INTEGER) AS customerCount
               FROM custinfo
              WHERE COALESCE(custstatus, 'active') <> 'inactive' COLLATE NOCASE
                AND CAST(COALESCE(custbalance, 0) AS REAL) > 0`,
          ),
          db.customer.findMany({
            where: {
              balance: { gt: 0 },
              OR: [{ status: null }, { status: { not: 'inactive' } }],
            },
            orderBy: [{ balance: 'desc' }, { name: 'asc' }],
            take: 5,
          }),
          this.recentCollections(db, asOf, 8),
        ]);
      const aging = agingRows[0] ?? {
        currentAmount: 0,
        oneToThirtyAmount: 0,
        thirtyOneToSixtyAmount: 0,
        sixtyOneToNinetyAmount: 0,
        overNinetyAmount: 0,
        datedInvoiceCount: 0,
        undatedAmount: 0,
        undatedInvoiceCount: 0,
      };
      const customerTotals = customerTotalRows[0] ?? {
        total: 0,
        customerCount: 0,
      };
      const datedTotal =
        this.amount(aging.currentAmount) +
        this.amount(aging.oneToThirtyAmount) +
        this.amount(aging.thirtyOneToSixtyAmount) +
        this.amount(aging.sixtyOneToNinetyAmount) +
        this.amount(aging.overNinetyAmount);
      const invoiceTotal = datedTotal + this.amount(aging.undatedAmount);
      const unallocatedAmount = Math.max(
        0,
        this.amount(customerTotals.total) - invoiceTotal,
      );
      return {
        asOf,
        totalReceivables: this.amount(customerTotals.total),
        customerCount: Number(customerTotals.customerCount ?? 0),
        invoiceTotal,
        reconciliationDifference:
          this.amount(customerTotals.total) - invoiceTotal,
        buckets: {
          current: this.amount(aging.currentAmount),
          oneToThirty: this.amount(aging.oneToThirtyAmount),
          thirtyOneToSixty: this.amount(aging.thirtyOneToSixtyAmount),
          sixtyOneToNinety: this.amount(aging.sixtyOneToNinetyAmount),
          overNinety: this.amount(aging.overNinetyAmount),
          unallocated: this.amount(aging.undatedAmount) + unallocatedAmount,
        },
        datedInvoiceCount: Number(aging.datedInvoiceCount ?? 0),
        unallocatedInvoiceCount: Number(aging.undatedInvoiceCount ?? 0),
        highestBalances,
        recentCollections,
        agingBasis: 'SALE_DATE' as const,
      };
    });
  }

  customerBalanceHistory(
    user: AuthenticatedPortalUser,
    storeId: string,
    customerId: number,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const customer = await db.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) throw new NotFoundException('Customer was not found.');
      const [openInvoices, payments] = await Promise.all([
        db.$queryRawUnsafe<
          Array<{
            id: number;
            reference: string;
            saleDate: string;
            totalAmount: number;
            balance: number;
            payment: string;
            paymentType: string;
          }>
        >(
          `SELECT salesid AS id, TRIM(COALESCE(salesrefnum, '')) AS reference,
                  COALESCE(salesdate, '') AS saleDate,
                  CAST(COALESCE(salestotalamount, 0) AS REAL) AS totalAmount,
                  CAST(COALESCE(tenderbalance, 0) AS REAL) AS balance,
                  TRIM(COALESCE(salespaym, '')) AS payment,
                  TRIM(COALESCE(salespaytype, '')) AS paymentType
             FROM salestbl
            WHERE CAST(COALESCE(salescustid, 0) AS INTEGER) = ?
              AND UPPER(TRIM(COALESCE(salestatus, ''))) = 'UNPAID'
              AND CAST(COALESCE(tenderbalance, 0) AS REAL) > 0
            ORDER BY datetime(salesdate) DESC, salesid DESC`,
          customerId,
        ),
        this.customerCollections(db, customerId, 50),
      ]);
      return {
        customer,
        openInvoices: openInvoices.map((invoice) => ({
          ...invoice,
          id: Number(invoice.id),
          totalAmount: this.amount(invoice.totalAmount),
          balance: this.amount(invoice.balance),
        })),
        payments,
      };
    });
  }

  customerInsights(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: CustomerInsightsQuery,
  ) {
    this.authorize(user, storeId);
    const range = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      const source = await this.customerInsightRows(db, range);
      const search = input.search?.trim().toLowerCase();
      const filtered = source.filter(
        (row) =>
          !search ||
          row.name.toLowerCase().includes(search) ||
          row.contact.toLowerCase().includes(search),
      );
      const rankBy = input.customerSort ?? 'SPEND';
      const sorted = [...filtered].sort((left, right) => {
        const difference =
          rankBy === 'VISITS'
            ? right.visitCount - left.visitCount
            : rankBy === 'RECENT'
              ? right.lastPurchaseDate.localeCompare(left.lastPurchaseDate)
              : rankBy === 'BALANCE'
                ? right.balance - left.balance
                : right.recordedSpend - left.recordedSpend;
        return difference === 0
          ? left.name.localeCompare(right.name)
          : difference;
      });
      const summary = filtered.reduce(
        (total, row) => ({
          customerCount: total.customerCount + 1,
          repeatCustomerCount:
            total.repeatCustomerCount + (row.visitCount > 1 ? 1 : 0),
          visitCount: total.visitCount + row.visitCount,
          recordedSpend: total.recordedSpend + row.recordedSpend,
          outstandingBalance: total.outstandingBalance + row.balance,
          lastPurchaseDate:
            row.lastPurchaseDate > total.lastPurchaseDate
              ? row.lastPurchaseDate
              : total.lastPurchaseDate,
        }),
        {
          customerCount: 0,
          repeatCustomerCount: 0,
          visitCount: 0,
          recordedSpend: 0,
          outstandingBalance: 0,
          lastPurchaseDate: '',
        },
      );
      const start = (input.page - 1) * input.pageSize;
      return {
        range,
        rankBy,
        summary: {
          ...summary,
          averagePurchase:
            summary.visitCount > 0
              ? summary.recordedSpend / summary.visitCount
              : 0,
        },
        items: sorted.slice(start, start + input.pageSize).map((row) => ({
          ...row,
          spendSharePercent:
            summary.recordedSpend > 0
              ? Math.round(
                  (row.recordedSpend / summary.recordedSpend) * 10_000,
                ) / 100
              : 0,
          daysSinceLastPurchase: row.lastPurchaseDate
            ? Math.max(
                0,
                this.daysBetween(row.lastPurchaseDate.slice(0, 10), range.to),
              )
            : null,
        })),
        total: sorted.length,
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }

  customerPurchaseHistory(
    user: AuthenticatedPortalUser,
    storeId: string,
    customerId: number,
    input: CustomerPurchaseHistoryQuery,
  ) {
    this.authorize(user, storeId);
    const range = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      const customer = await db.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) throw new NotFoundException('Customer was not found.');
      const [rows, aggregateRows] = await Promise.all([
        db.$queryRawUnsafe<CustomerPurchaseRow[]>(
          `SELECT CAST(salesid AS INTEGER) AS id,
                  COALESCE(salesdate, '') AS saleDate,
                  TRIM(COALESCE(salesrefnum, '')) AS reference,
                  TRIM(COALESCE(salespaym, '')) AS payment,
                  TRIM(COALESCE(salestatus, '')) AS status,
                  CAST(COALESCE(salestotalitem, 0) AS INTEGER) AS itemCount,
                  CAST(COALESCE(salestotalamount, 0) AS REAL) AS totalAmount,
                  CAST(COALESCE(tenderbalance, 0) AS REAL) AS tenderBalance
             FROM salestbl
            WHERE CAST(COALESCE(salescustid, 0) AS INTEGER) = ?
              AND date(salesdate) BETWEEN date(?) AND date(?)
              AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
            ORDER BY datetime(salesdate) DESC, salesid DESC
            LIMIT ? OFFSET ?`,
          customerId,
          range.from,
          range.to,
          input.pageSize,
          (input.page - 1) * input.pageSize,
        ),
        db.$queryRawUnsafe<
          Array<{
            visitCount: number;
            recordedSpend: number;
            firstPurchaseDate: string;
            lastPurchaseDate: string;
          }>
        >(
          `SELECT CAST(COUNT(*) AS INTEGER) AS visitCount,
                  CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) AS recordedSpend,
                  COALESCE(MIN(salesdate), '') AS firstPurchaseDate,
                  COALESCE(MAX(salesdate), '') AS lastPurchaseDate
             FROM salestbl
            WHERE CAST(COALESCE(salescustid, 0) AS INTEGER) = ?
              AND date(salesdate) BETWEEN date(?) AND date(?)
              AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'`,
          customerId,
          range.from,
          range.to,
        ),
      ]);
      const aggregate = aggregateRows[0] ?? {
        visitCount: 0,
        recordedSpend: 0,
        firstPurchaseDate: '',
        lastPurchaseDate: '',
      };
      const visitCount = Number(aggregate.visitCount ?? 0);
      const recordedSpend = this.amount(aggregate.recordedSpend);
      return {
        range,
        customer: {
          id: customer.id,
          name: customer.name?.trim() || 'Unnamed customer',
          contact: customer.contact?.trim() ?? '',
          balance: this.amount(customer.balance),
          status: customer.status?.trim() || 'active',
        },
        summary: {
          visitCount,
          recordedSpend,
          averagePurchase: visitCount > 0 ? recordedSpend / visitCount : 0,
          firstPurchaseDate: aggregate.firstPurchaseDate,
          lastPurchaseDate: aggregate.lastPurchaseDate,
        },
        items: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          itemCount: Number(row.itemCount ?? 0),
          totalAmount: this.amount(row.totalAmount),
          tenderBalance: this.amount(row.tenderBalance),
        })),
        total: visitCount,
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }

  sales(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const saleReferences = await this.saleReferencesForItem(
        db,
        input.itemCode,
      );
      const where = this.salesWhere(input, saleReferences);
      const dateWhere = { saleDate: this.dateWhere(input) };
      const [items, total, statusOptions, paymentOptions] = await Promise.all([
        db.sale.findMany({
          where,
          orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        db.sale.count({ where }),
        db.sale.findMany({
          where: dateWhere,
          select: { status: true },
          distinct: ['status'],
        }),
        db.sale.findMany({
          where: dateWhere,
          select: { payment: true },
          distinct: ['payment'],
        }),
      ]);
      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        filterOptions: {
          statuses: this.stringOptions(
            statusOptions.map((item) => item.status),
          ),
          payments: this.stringOptions(
            paymentOptions.map((item) => item.payment),
          ),
        },
      };
    });
  }

  saleDetails(user: AuthenticatedPortalUser, storeId: string, saleId: number) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const sale = await db.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw new NotFoundException('Sale was not found.');
      const items = sale.reference
        ? await db.saleItem.findMany({
            where: { reference: sale.reference },
            orderBy: { id: 'asc' },
          })
        : [];
      const noteColumns = await db.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM pragma_table_info('salestbl') WHERE LOWER(name) = 'salesremarks'",
      );
      const noteRows = noteColumns.length
        ? await db.$queryRawUnsafe<Array<{ notes: string | null }>>(
            'SELECT salesremarks AS notes FROM salestbl WHERE salesid = ? LIMIT 1',
            saleId,
          )
        : [];
      return {
        sale,
        items,
        notes: noteRows[0]?.notes?.trim() ?? '',
        attachmentStatus: 'NOT_SYNCED' as const,
      };
    });
  }

  inventory(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const where = this.inventoryWhere(db, input);
      const [items, total, categoryRows, summaryRows] = await Promise.all([
        db.inventoryItem.findMany({
          where,
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        db.inventoryItem.count({ where }),
        db.inventoryItem.findMany({
          select: { category: true },
          distinct: ['category'],
          orderBy: { category: 'asc' },
        }),
        db.$queryRawUnsafe<InventorySummaryRow[]>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS trackedItems,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) <= 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS outOfStockItems,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) > 0 AND COALESCE(alertnum, 0) > 0 AND fillqty <= alertnum THEN 1 ELSE 0 END), 0) AS INTEGER) AS criticalItems,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) > 0 AND (COALESCE(alertnum, 0) <= 0 OR fillqty > alertnum) THEN 1 ELSE 0 END), 0) AS INTEGER) AS healthyItems,
                  CAST(COALESCE(SUM(fillqty), 0) AS INTEGER) AS storeFill,
                  CAST(COALESCE(SUM(emptyqty), 0) AS INTEGER) AS storeEmpty,
                  CAST(COALESCE(SUM(whfill), 0) AS INTEGER) AS warehouseFill,
                  CAST(COALESCE(SUM(whempty), 0) AS INTEGER) AS warehouseEmpty,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(itemcost, 0) > 0 THEN (COALESCE(fillqty, 0) + COALESCE(whfill, 0)) * itemcost ELSE 0 END), 0) AS REAL) AS recordedValue,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) + COALESCE(whfill, 0) > 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS stockBearingItems,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) + COALESCE(whfill, 0) > 0 AND COALESCE(itemcost, 0) > 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS valuedItems,
                  CAST(COALESCE(SUM(CASE WHEN COALESCE(fillqty, 0) + COALESCE(whfill, 0) > 0 AND COALESCE(itemcost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS INTEGER) AS missingCostItems
             FROM inventorytbl`,
        ),
      ]);
      const prices = await this.inventoryPriceMap(
        db,
        items.map((item) => item.id),
      );
      const summary = summaryRows[0] ?? {
        trackedItems: 0,
        outOfStockItems: 0,
        criticalItems: 0,
        healthyItems: 0,
        storeFill: 0,
        storeEmpty: 0,
        warehouseFill: 0,
        warehouseEmpty: 0,
        recordedValue: 0,
        stockBearingItems: 0,
        valuedItems: 0,
        missingCostItems: 0,
      };
      return {
        items: items.map((item) => ({
          ...item,
          refillPrice: prices.get(item.id)?.refillPrice ?? null,
          nonRefillPrice: prices.get(item.id)?.nonRefillPrice ?? null,
          stockStatus: this.inventoryStockStatus(item),
          recordedValue:
            this.amount(item.cost) *
            (Number(item.fillQuantity ?? 0) + Number(item.warehouseFill ?? 0)),
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
        summary: {
          trackedItems: Number(summary.trackedItems),
          outOfStockItems: Number(summary.outOfStockItems),
          criticalItems: Number(summary.criticalItems),
          healthyItems: Number(summary.healthyItems),
          storeFill: Number(summary.storeFill),
          storeEmpty: Number(summary.storeEmpty),
          warehouseFill: Number(summary.warehouseFill),
          warehouseEmpty: Number(summary.warehouseEmpty),
          recordedValue: this.amount(summary.recordedValue),
          stockBearingItems: Number(summary.stockBearingItems),
          valuedItems: Number(summary.valuedItems),
          missingCostItems: Number(summary.missingCostItems),
          valuationCoveragePercent:
            Number(summary.stockBearingItems) === 0
              ? 100
              : Math.round(
                  (Number(summary.valuedItems) /
                    Number(summary.stockBearingItems)) *
                    10_000,
                ) / 100,
          valuationComplete: Number(summary.missingCostItems) === 0,
        },
        filterOptions: {
          categories: this.stringOptions(
            categoryRows.map((row) => row.category),
          ),
          stockStatuses: ['OUT_OF_STOCK', 'CRITICAL', 'HEALTHY'],
        },
      };
    });
  }

  inventoryForecast(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: InventoryForecastQuery,
  ) {
    this.authorize(user, storeId);
    const range = this.requiredDateRange(input);
    return this.withFreshness(storeId, async (db) => {
      const forecast = await this.inventoryForecastRows(db, input, range);
      const selectedCategory = input.category?.trim().toLocaleLowerCase();
      const filtered = forecast.items.filter((item) => {
        const search = input.search?.trim().toLowerCase();
        return (
          (!search ||
            item.code.toLowerCase().includes(search) ||
            item.item.toLowerCase().includes(search) ||
            item.category.toLowerCase().includes(search)) &&
          (!selectedCategory ||
            item.category.toLocaleLowerCase() === selectedCategory) &&
          (!input.risk || item.risk === input.risk)
        );
      });
      const start = (input.page - 1) * input.pageSize;
      const summary = filtered.reduce(
        (total, item) => {
          total.availableStock += item.availableStock;
          total.projectedDemand += item.projectedDemand;
          total.suggestedReorder += item.suggestedReorder;
          total.estimatedReorderCost += item.estimatedReorderCost;
          if (item.risk === 'OUT_OF_STOCK') total.outOfStockItems += 1;
          if (item.risk === 'REORDER_NOW') total.reorderNowItems += 1;
          if (item.risk === 'WATCH') total.watchItems += 1;
          if (item.risk === 'NO_RECENT_SALES') total.noRecentSalesItems += 1;
          return total;
        },
        {
          availableStock: 0,
          projectedDemand: 0,
          suggestedReorder: 0,
          estimatedReorderCost: 0,
          outOfStockItems: 0,
          reorderNowItems: 0,
          watchItems: 0,
          noRecentSalesItems: 0,
        },
      );
      return {
        items: filtered.slice(start, start + input.pageSize),
        total: filtered.length,
        page: input.page,
        pageSize: input.pageSize,
        analysisDays: forecast.analysisDays,
        forecastDays: forecast.forecastDays,
        leadTimeDays: forecast.leadTimeDays,
        summary: {
          ...summary,
          estimatedReorderCost: this.amount(summary.estimatedReorderCost),
          attentionItems: summary.outOfStockItems + summary.reorderNowItems,
        },
        filterOptions: {
          categories: forecast.categories,
          risks: [
            'OUT_OF_STOCK',
            'REORDER_NOW',
            'WATCH',
            'HEALTHY',
            'NO_RECENT_SALES',
          ] as InventoryForecastRisk[],
        },
      };
    });
  }

  inventoryHistory(
    user: AuthenticatedPortalUser,
    storeId: string,
    itemId: number,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Inventory item was not found.');
      const itemPrices = await this.inventoryPriceMap(db, [item.id]);
      const itemWithPrices = {
        ...item,
        refillPrice: itemPrices.get(item.id)?.refillPrice ?? null,
        nonRefillPrice: itemPrices.get(item.id)?.nonRefillPrice ?? null,
      };
      const range = this.requiredDateRange(input);
      const historyExists = await this.tableExists(db, 'itemhistorytbl');
      const adjustmentsExist = await this.tableExists(
        db,
        'inventory_adjustments',
      );
      const queries: string[] = [];
      if (historyExists) {
        const columns = await this.tableColumns(db, 'itemhistorytbl');
        const before = columns.has('itemhfromqty') ? 'itemhfromqty' : 'NULL';
        const after = columns.has('itemhtoqty') ? 'itemhtoqty' : 'NULL';
        queries.push(
          `SELECT CAST(COALESCE(itemhid, rowid) AS INTEGER) AS id,
                  COALESCE(itemhdate, '') AS movementDate,
                  TRIM(COALESCE(itemhrefnum, '')) AS reference,
                  CAST(COALESCE(itemhqty, 0) AS INTEGER) AS quantity,
                  TRIM(COALESCE(itemhorigin, '')) AS origin,
                  TRIM(COALESCE(itemhremarks, '')) AS remarks,
                  ${before} AS quantityBefore,
                  ${after} AS quantityAfter
             FROM itemhistorytbl
            WHERE LOWER(TRIM(COALESCE(itemhitemc, ''))) = LOWER(TRIM(?))
              AND date(itemhdate) BETWEEN date(?) AND date(?)`,
        );
      }
      if (adjustmentsExist) {
        queries.push(
          `SELECT -CAST(adjustment_id AS INTEGER) AS id,
                  COALESCE(adjusted_at, '') AS movementDate,
                  'ADJ-' || CAST(adjustment_id AS TEXT) AS reference,
                  CAST(COALESCE(quantity_delta, 0) AS INTEGER) AS quantity,
                  'STORE ' || TRIM(COALESCE(unit, '')) || ' ADJUSTMENT' AS origin,
                  TRIM(COALESCE(reason, '') || CASE WHEN TRIM(COALESCE(remarks, '')) = '' THEN '' ELSE ' - ' || remarks END) AS remarks,
                  CAST(COALESCE(quantity_before, 0) AS INTEGER) AS quantityBefore,
                  CAST(COALESCE(quantity_after, 0) AS INTEGER) AS quantityAfter
             FROM inventory_adjustments adjustment
            WHERE itemid = ?
              AND date(adjusted_at) BETWEEN date(?) AND date(?)
              ${historyExists ? "AND NOT EXISTS (SELECT 1 FROM itemhistorytbl legacy WHERE legacy.itemhrefnum = 'ADJ-' || adjustment.adjustment_id)" : ''}`,
        );
      }
      if (!queries.length) {
        return {
          item: {
            ...itemWithPrices,
            stockStatus: this.inventoryStockStatus(item),
          },
          items: [],
          total: 0,
          page: input.page,
          pageSize: input.pageSize,
          historyAvailable: false,
        };
      }
      const parameters: Array<string | number> = [];
      if (historyExists) parameters.push(item.code ?? '', range.from, range.to);
      if (adjustmentsExist) parameters.push(item.id, range.from, range.to);
      const union = queries.join(' UNION ALL ');
      const offset = (input.page - 1) * input.pageSize;
      const [rows, countRows] = await Promise.all([
        db.$queryRawUnsafe<InventoryHistoryRow[]>(
          `SELECT * FROM (${union}) movements
           ORDER BY datetime(movementDate) DESC, id DESC
           LIMIT ? OFFSET ?`,
          ...parameters,
          input.pageSize,
          offset,
        ),
        db.$queryRawUnsafe<Array<{ total: number }>>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM (${union}) movements`,
          ...parameters,
        ),
      ]);
      return {
        item: {
          ...itemWithPrices,
          stockStatus: this.inventoryStockStatus(item),
        },
        items: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          quantity: Number(row.quantity),
          quantityBefore:
            row.quantityBefore === null ? null : Number(row.quantityBefore),
          quantityAfter:
            row.quantityAfter === null ? null : Number(row.quantityAfter),
        })),
        total: Number(countRows[0]?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        historyAvailable: true,
      };
    });
  }

  transfers(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const where = this.transfersWhere(input);
      const [items, total] = await Promise.all([
        db.transfer.findMany({
          where,
          orderBy: [{ transferDate: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        db.transfer.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    });
  }

  transferDetails(
    user: AuthenticatedPortalUser,
    storeId: string,
    transferId: number,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const transferColumns = await this.tableColumns(db, 'pouttbl');
      const personnelTableExists = await this.tableExists(db, 'personeltbl');
      const personnelColumns = personnelTableExists
        ? await this.tableColumns(db, 'personeltbl')
        : new Set<string>();
      const hasDriver =
        transferColumns.has('poutpid') &&
        personnelColumns.has('pid') &&
        personnelColumns.has('pname');
      const optionalText = (column: string) =>
        transferColumns.has(column)
          ? `TRIM(COALESCE(transfer.${column}, ''))`
          : "''";
      const transferRows = await db.$queryRawUnsafe<TransferDetailRow[]>(
        `SELECT CAST(transfer.poutid AS INTEGER) AS id,
                TRIM(COALESCE(transfer.poutrefnum, '')) AS reference,
                TRIM(COALESCE(transfer.pullsupplier, '')) AS supplier,
                TRIM(COALESCE(transfer.pouttransto, '')) AS destination,
                UPPER(TRIM(COALESCE(transfer.pouttype, ''))) AS type,
                CAST(COALESCE(transfer.pouttotalqty, 0) AS INTEGER) AS totalQuantity,
                CAST(COALESCE(transfer.pouttotalamount, 0) AS REAL) AS totalAmount,
                TRIM(COALESCE(transfer.poutencoder, '')) AS encoder,
                COALESCE(transfer.pulldate, '') AS transferDate,
                UPPER(TRIM(COALESCE(transfer.pulloutremarks, 'WAITING'))) AS status,
                CAST(COALESCE(transfer.restockprice, 0) AS REAL) AS restockPrice,
                TRIM(COALESCE(transfer.notes, '')) AS notes,
                ${optionalText('invoice_reference')} AS invoiceReference,
                ${optionalText('confirmed_at')} AS confirmedAt,
                ${optionalText('paid_at')} AS paidAt,
                ${optionalText('payment_method')} AS paymentMethod,
                ${optionalText('payment_reference')} AS paymentReference,
                UPPER(${optionalText('payment_status')}) AS paymentStatus,
                ${hasDriver ? 'NULLIF(CAST(COALESCE(transfer.poutpid, 0) AS INTEGER), 0)' : 'NULL'} AS driverId,
                ${hasDriver ? "TRIM(COALESCE(personnel.pname, ''))" : "''"} AS driverName
           FROM pouttbl transfer
           ${hasDriver ? 'LEFT JOIN personeltbl personnel ON CAST(personnel.pid AS INTEGER) = CAST(COALESCE(transfer.poutpid, 0) AS INTEGER)' : ''}
          WHERE transfer.poutid = ?
          LIMIT 1`,
        transferId,
      );
      const transfer = transferRows[0];
      if (!transfer)
        throw new NotFoundException('Transfer record was not found.');

      const lineTableExists = await this.tableExists(db, 'pulloutcart');
      const lineColumns = lineTableExists
        ? await this.tableColumns(db, 'pulloutcart')
        : new Set<string>();
      const lines = lineTableExists
        ? await db.$queryRawUnsafe<TransferLineDetailRow[]>(
            `SELECT CAST(cart.pid AS INTEGER) AS id,
                    TRIM(COALESCE(cart.poutitemcode, '')) AS itemCode,
                    TRIM(COALESCE(cart.poutitemname, '')) AS itemName,
                    TRIM(COALESCE(item.itemsize, '')) AS itemSize,
                    CASE
                      WHEN UPPER(COALESCE(cart.pouttype, '')) LIKE '%EMPTY' THEN 'EMPTY'
                      WHEN UPPER(COALESCE(cart.pouttype, '')) LIKE '%FILL' THEN 'FULL'
                      WHEN ? IN ('IN', 'RESTOCK OUT') THEN 'EMPTY'
                      ELSE 'FULL'
                    END AS unit,
                    CAST(COALESCE(cart.poutqty, 0) AS INTEGER) AS quantity,
                    ${lineColumns.has('poutcost') ? 'CAST(COALESCE(cart.poutcost, 0) AS REAL)' : '0'} AS unitCost,
                    ${lineColumns.has('poutotal') ? 'CAST(COALESCE(cart.poutotal, 0) AS REAL)' : '0'} AS lineTotal
               FROM pulloutcart cart
               LEFT JOIN inventorytbl item ON item.itemcode = cart.poutitemcode
              WHERE cart.poutref = ?
              ORDER BY cart.pid`,
            transfer.type,
            transfer.reference,
          )
        : [];

      const paymentTableExists = await this.tableExists(
        db,
        'supplier_restock_payments',
      );
      const paymentColumns = paymentTableExists
        ? await this.tableColumns(db, 'supplier_restock_payments')
        : new Set<string>();
      const paymentText = (column: string) =>
        paymentColumns.has(column) ? `TRIM(COALESCE(${column}, ''))` : "''";
      const payments = paymentTableExists
        ? await db.$queryRawUnsafe<TransferPaymentDetailRow[]>(
            `SELECT CAST(payment_id AS INTEGER) AS id,
                    UPPER(COALESCE(NULLIF(${paymentText('payment_kind')}, ''), 'PAYMENT')) AS kind,
                    CAST(COALESCE(amount, 0) AS REAL) AS amount,
                    ${paymentText('payment_method')} AS method,
                    ${paymentText('payment_reference')} AS reference,
                    ${paymentText('notes')} AS notes,
                    ${paymentColumns.has('paid_at') ? "COALESCE(paid_at, '')" : "''"} AS paidAt,
                    ${paymentText('recorded_by')} AS recordedBy
               FROM supplier_restock_payments
              WHERE transfer_id = ?
              ORDER BY ${paymentColumns.has('paid_at') ? 'datetime(paid_at) DESC,' : ''} payment_id DESC`,
            transferId,
          )
        : [];
      const paidAmount = payments.reduce(
        (total, payment) =>
          total +
          (payment.kind === 'REFUND'
            ? -this.amount(payment.amount)
            : this.amount(payment.amount)),
        0,
      );
      const purchaseAmount =
        this.amount(transfer.restockPrice) > 0
          ? this.amount(transfer.restockPrice)
          : this.amount(transfer.totalAmount);

      return {
        transfer: {
          ...transfer,
          id: Number(transfer.id),
          driverId:
            transfer.driverId === null ? null : Number(transfer.driverId),
          totalQuantity: Number(transfer.totalQuantity),
          totalAmount: this.amount(transfer.totalAmount),
          restockPrice: this.amount(transfer.restockPrice),
          purchaseAmount,
          paidAmount: this.amount(paidAmount),
          outstandingAmount: Math.max(0, purchaseAmount - paidAmount),
        },
        lines: lines.map((line) => ({
          ...line,
          id: Number(line.id),
          quantity: Number(line.quantity),
          unitCost: this.amount(line.unitCost),
          lineTotal: this.amount(line.lineTotal),
        })),
        payments: payments.map((payment) => ({
          ...payment,
          id: Number(payment.id),
          amount: this.amount(payment.amount),
        })),
        lineItemsAvailable: lineTableExists,
        paymentHistoryAvailable: paymentTableExists,
      };
    });
  }

  restockMonitoring(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const range = this.requiredDateRange(input);
      const search = `%${input.search?.trim() ?? ''}%`;
      const paymentTableExists = await this.tableExists(
        db,
        'supplier_restock_payments',
      );
      const paymentJoin = paymentTableExists
        ? `LEFT JOIN (
             SELECT transfer_id,
                    SUM(CASE WHEN UPPER(TRIM(COALESCE(payment_kind, 'PAYMENT'))) <> 'REFUND' THEN amount ELSE 0 END) AS payments,
                    SUM(CASE WHEN UPPER(TRIM(COALESCE(payment_kind, 'PAYMENT'))) = 'REFUND' THEN amount ELSE 0 END) AS refunds
               FROM supplier_restock_payments
              GROUP BY transfer_id
           ) paid ON paid.transfer_id = transfer.poutid`
        : '';
      const payments = paymentTableExists
        ? 'CAST(COALESCE(paid.payments, 0) AS REAL)'
        : '0';
      const refunds = paymentTableExists
        ? 'CAST(COALESCE(paid.refunds, 0) AS REAL)'
        : '0';
      const baseSql = `
        SELECT CAST(transfer.poutid AS INTEGER) AS id,
               TRIM(COALESCE(transfer.poutrefnum, '')) AS reference,
               COALESCE(NULLIF(TRIM(transfer.pullsupplier), ''), 'Unspecified supplier') AS supplier,
               COALESCE(transfer.pulldate, '') AS transferDate,
               UPPER(TRIM(COALESCE(transfer.pulloutremarks, 'WAITING'))) AS receiptStatus,
               UPPER(TRIM(COALESCE(transfer.payment_status, 'UNPAID'))) AS paymentStatus,
               CAST(COALESCE(transfer.pouttotalqty, 0) AS INTEGER) AS quantity,
               CAST(CASE WHEN COALESCE(transfer.restockprice, 0) > 0 THEN transfer.restockprice ELSE COALESCE(transfer.pouttotalamount, 0) END AS REAL) AS purchaseAmount,
               ${payments} AS payments,
               ${refunds} AS refunds
          FROM pouttbl transfer
          ${paymentJoin}
         WHERE UPPER(TRIM(COALESCE(transfer.pouttype, ''))) IN ('RESTOCK IN', 'W.RESTOCK IN')
           AND date(transfer.pulldate) BETWEEN date(?) AND date(?)
           AND (TRIM(COALESCE(transfer.poutrefnum, '')) LIKE ? COLLATE NOCASE
             OR TRIM(COALESCE(transfer.pullsupplier, '')) LIKE ? COLLATE NOCASE)`;
      const parameters = [range.from, range.to, search, search] as const;
      const offset = (input.page - 1) * input.pageSize;
      const [rows, countRows, periodPaymentRows, cashFlow] = await Promise.all([
        db.$queryRawUnsafe<RestockMonitoringRow[]>(
          `${baseSql} ORDER BY datetime(transferDate) DESC, id DESC LIMIT ? OFFSET ?`,
          ...parameters,
          input.pageSize,
          offset,
        ),
        db.$queryRawUnsafe<Array<{ total: number }>>(
          `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM (${baseSql}) restocks`,
          ...parameters,
        ),
        paymentTableExists
          ? db.$queryRawUnsafe<Array<{ payments: number; refunds: number }>>(
              `SELECT CAST(COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(payment.payment_kind, 'PAYMENT'))) <> 'REFUND' THEN payment.amount ELSE 0 END), 0) AS REAL) AS payments,
                      CAST(COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(payment.payment_kind, 'PAYMENT'))) = 'REFUND' THEN payment.amount ELSE 0 END), 0) AS REAL) AS refunds
                 FROM supplier_restock_payments payment
                 INNER JOIN pouttbl transfer ON transfer.poutid = payment.transfer_id
                WHERE UPPER(TRIM(COALESCE(transfer.pouttype, ''))) IN ('RESTOCK IN', 'W.RESTOCK IN')
                  AND date(payment.paid_at) BETWEEN date(?) AND date(?)`,
              range.from,
              range.to,
            )
          : Promise.resolve([{ payments: 0, refunds: 0 }]),
        this.cashFlowTotals(db, range),
      ]);
      const normalized = rows.map((row) => {
        const purchaseAmount = this.amount(row.purchaseAmount);
        const paid = this.amount(row.payments) - this.amount(row.refunds);
        return {
          ...row,
          id: Number(row.id),
          quantity: Number(row.quantity),
          purchaseAmount,
          payments: this.amount(row.payments),
          refunds: this.amount(row.refunds),
          netPaid: paid,
          outstanding: Math.max(0, purchaseAmount - paid),
        };
      });
      const allSummaryRows = await db.$queryRawUnsafe<
        Array<{
          confirmedRestocks: number;
          receivedQuantity: number;
          purchaseAmount: number;
          outstandingPayables: number;
        }>
      >(
        `SELECT CAST(COALESCE(SUM(CASE WHEN receiptStatus = 'CONFIRMED' THEN 1 ELSE 0 END), 0) AS INTEGER) AS confirmedRestocks,
                CAST(COALESCE(SUM(CASE WHEN receiptStatus = 'CONFIRMED' THEN quantity ELSE 0 END), 0) AS INTEGER) AS receivedQuantity,
                CAST(COALESCE(SUM(CASE WHEN receiptStatus = 'CONFIRMED' THEN purchaseAmount ELSE 0 END), 0) AS REAL) AS purchaseAmount,
                CAST(COALESCE(SUM(CASE WHEN receiptStatus <> 'CANCELLED' THEN MAX(0, purchaseAmount - (payments - refunds)) ELSE 0 END), 0) AS REAL) AS outstandingPayables
           FROM (${baseSql}) restocks`,
        ...parameters,
      );
      const periodPayments = this.amount(periodPaymentRows[0]?.payments);
      const periodRefunds = this.amount(periodPaymentRows[0]?.refunds);
      const summary = allSummaryRows[0];
      return {
        items: normalized,
        total: Number(countRows[0]?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        summary: {
          confirmedRestocks: Number(summary?.confirmedRestocks ?? 0),
          receivedQuantity: Number(summary?.receivedQuantity ?? 0),
          purchaseAmount: this.amount(summary?.purchaseAmount),
          supplierPayments: periodPayments,
          supplierRefunds: periodRefunds,
          netSupplierPayments: periodPayments - periodRefunds,
          outstandingPayables: this.amount(summary?.outstandingPayables),
          cashFlowRestockPayments: cashFlow.restockPayments,
          reconciliationDifference:
            periodPayments - periodRefunds - cashFlow.restockPayments,
        },
      };
    });
  }

  productPerformance(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const dates = this.requiredDateRange(range);
      const aggregateSql = `
        WITH sold AS (
          SELECT LOWER(TRIM(COALESCE(line.scitemcode, ''))) AS item_key,
                 COALESCE(NULLIF(TRIM(line.scitemcode), ''), 'Uncoded item') AS itemCode,
                 COALESCE(NULLIF(TRIM(line.scitemdesc), ''), 'Unnamed item') AS item,
                 CAST(COALESCE(SUM(line.scqty), 0) AS INTEGER) AS quantity,
                 CAST(COALESCE(SUM(line.sctotal), 0) AS REAL) AS revenue,
                 CAST(COALESCE(SUM(line.totalcost), 0) AS REAL) AS recordedCost,
                 CAST(COALESCE(SUM(CASE WHEN COALESCE(line.sctotal, 0) > 0 AND (line.totalcost IS NULL OR line.totalcost <= 0) THEN 1 ELSE 0 END), 0) AS INTEGER) AS missingCostLines
            FROM salescart line
            INNER JOIN salestbl sale ON sale.salesrefnum = line.screfnum
           WHERE date(sale.salesdate) BETWEEN date(?) AND date(?)
             AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
             AND UPPER(TRIM(COALESCE(line.scstats, ''))) <> 'CANCELLED'
           GROUP BY item_key, itemCode, item
        )
        SELECT sold.itemCode, sold.item,
               COALESCE(NULLIF(TRIM(inventory.itemcategory), ''), 'Uncategorized') AS category,
               sold.quantity, sold.revenue, sold.recordedCost, sold.missingCostLines
          FROM sold
          LEFT JOIN inventorytbl inventory
            ON LOWER(TRIM(COALESCE(inventory.itemcode, ''))) = sold.item_key`;
      const [soldRows, inventoryRows] = await Promise.all([
        db.$queryRawUnsafe<ProductPerformanceRow[]>(
          aggregateSql,
          dates.from,
          dates.to,
        ),
        db.$queryRawUnsafe<
          Array<{ itemCode: string; item: string; category: string }>
        >(
          `SELECT COALESCE(NULLIF(TRIM(itemcode), ''), 'Uncoded item') AS itemCode,
                  COALESCE(NULLIF(TRIM(itemname), ''), NULLIF(TRIM(itembrand), ''), 'Unnamed item') AS item,
                  COALESCE(NULLIF(TRIM(itemcategory), ''), 'Uncategorized') AS category
             FROM inventorytbl
            ORDER BY item COLLATE NOCASE`,
        ),
      ]);
      const products = soldRows.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        revenue: this.amount(row.revenue),
        recordedCost: this.amount(row.recordedCost),
        recordedGrossProfit:
          this.amount(row.revenue) - this.amount(row.recordedCost),
        missingCostLines: Number(row.missingCostLines),
      }));
      const byCode = new Map(
        products.map((row) => [row.itemCode.trim().toLowerCase(), row]),
      );
      const slowMoving = inventoryRows
        .map((item) => {
          const sold = byCode.get(item.itemCode.trim().toLowerCase());
          return {
            ...item,
            quantity: sold?.quantity ?? 0,
            revenue: sold?.revenue ?? 0,
            recordedCost: sold?.recordedCost ?? 0,
            recordedGrossProfit: sold?.recordedGrossProfit ?? 0,
            missingCostLines: sold?.missingCostLines ?? 0,
          };
        })
        .sort((left, right) =>
          left.quantity === right.quantity
            ? left.item.localeCompare(right.item)
            : left.quantity - right.quantity,
        )
        .slice(0, 10);
      const categories = new Map<
        string,
        {
          category: string;
          quantity: number;
          revenue: number;
          recordedCost: number;
        }
      >();
      for (const row of products) {
        const current = categories.get(row.category) ?? {
          category: row.category,
          quantity: 0,
          revenue: 0,
          recordedCost: 0,
        };
        current.quantity += row.quantity;
        current.revenue += row.revenue;
        current.recordedCost += row.recordedCost;
        categories.set(row.category, current);
      }
      const summary = products.reduce(
        (total, row) => ({
          quantity: total.quantity + row.quantity,
          revenue: total.revenue + row.revenue,
          recordedCost: total.recordedCost + row.recordedCost,
          missingCostLines: total.missingCostLines + row.missingCostLines,
        }),
        { quantity: 0, revenue: 0, recordedCost: 0, missingCostLines: 0 },
      );
      return {
        summary: {
          ...summary,
          recordedGrossProfit: summary.revenue - summary.recordedCost,
          costDataComplete: summary.missingCostLines === 0,
        },
        topSelling: [...products]
          .sort((left, right) =>
            right.quantity === left.quantity
              ? right.revenue - left.revenue
              : right.quantity - left.quantity,
          )
          .slice(0, 10),
        slowMoving,
        categories: [...categories.values()]
          .map((row) => ({
            ...row,
            recordedGrossProfit: row.revenue - row.recordedCost,
          }))
          .sort((left, right) => right.revenue - left.revenue),
      };
    });
  }

  profitability(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: ProfitabilityQuery,
  ) {
    this.authorize(user, storeId);
    const currentRange = this.requiredDateRange(input);
    const previousRange = this.previousDateRange(
      currentRange.from,
      currentRange.to,
    );
    return this.withFreshness(storeId, async (db) => {
      const [currentSource, previousSource] = await Promise.all([
        this.profitabilityRows(db, currentRange),
        this.profitabilityRows(db, previousRange),
      ]);
      const filter = (rows: ProfitabilityRecord[]) => {
        const search = input.search?.trim().toLowerCase();
        const category = input.category?.trim().toLocaleLowerCase();
        return rows.filter(
          (row) =>
            (!search ||
              row.itemCode.toLowerCase().includes(search) ||
              row.item.toLowerCase().includes(search) ||
              row.category.toLowerCase().includes(search)) &&
            (!category || row.category.toLocaleLowerCase() === category),
        );
      };
      const current = filter(currentSource);
      const previous = filter(previousSource);
      const rankBy = input.profitabilitySort ?? 'PROFIT';
      const previousByCode = new Map(
        previous.map((row) => [row.itemCode.trim().toLowerCase(), row]),
      );
      const products = current
        .map((row) => {
          const prior = previousByCode.get(row.itemCode.trim().toLowerCase());
          const previousRevenue = prior?.revenue ?? 0;
          const previousRecordedGrossProfit = prior?.recordedGrossProfit ?? 0;
          const previousRecordedMarginPercent =
            prior?.recordedMarginPercent ?? 0;
          return {
            ...row,
            previousRevenue,
            previousRecordedGrossProfit,
            previousRecordedMarginPercent,
            revenueChange: row.revenue - previousRevenue,
            recordedGrossProfitChange:
              row.recordedGrossProfit - previousRecordedGrossProfit,
            recordedMarginPointChange:
              Math.round(
                (row.recordedMarginPercent - previousRecordedMarginPercent) *
                  100,
              ) / 100,
            recordedGrossProfitChangePercent: this.percentageChange(
              row.recordedGrossProfit,
              previousRecordedGrossProfit,
            ),
          };
        })
        .sort((left, right) => {
          const metric =
            rankBy === 'MARGIN'
              ? 'recordedMarginPercent'
              : rankBy === 'REVENUE'
                ? 'revenue'
                : 'recordedGrossProfit';
          const difference = right[metric] - left[metric];
          return difference === 0
            ? left.item.localeCompare(right.item)
            : difference;
        });
      const currentSummary = this.profitabilitySummary(current);
      const previousSummary = this.profitabilitySummary(previous);
      const categories = this.profitabilityCategories(current, previous).sort(
        (left, right) => {
          const metric =
            rankBy === 'MARGIN'
              ? 'recordedMarginPercent'
              : rankBy === 'REVENUE'
                ? 'revenue'
                : 'recordedGrossProfit';
          return right[metric] - left[metric];
        },
      );
      const start = (input.page - 1) * input.pageSize;
      return {
        currentRange,
        previousRange,
        rankBy,
        summary: {
          current: currentSummary,
          previous: previousSummary,
          revenueChange: currentSummary.revenue - previousSummary.revenue,
          recordedGrossProfitChange:
            currentSummary.recordedGrossProfit -
            previousSummary.recordedGrossProfit,
          recordedMarginPointChange:
            Math.round(
              (currentSummary.recordedMarginPercent -
                previousSummary.recordedMarginPercent) *
                100,
            ) / 100,
          recordedGrossProfitChangePercent: this.percentageChange(
            currentSummary.recordedGrossProfit,
            previousSummary.recordedGrossProfit,
          ),
        },
        categories,
        items: products.slice(start, start + input.pageSize),
        total: products.length,
        page: input.page,
        pageSize: input.pageSize,
        filterOptions: {
          categories: this.stringOptions(
            [...currentSource, ...previousSource].map((row) => row.category),
          ),
        },
      };
    });
  }

  paymentAnalysis(
    user: AuthenticatedPortalUser,
    storeId: string,
    range: DateRange,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const dates = this.requiredDateRange(range);
      const creditColumns = await this.tableColumns(db, 'creditpaymenttbl');
      const creditMethod = creditColumns.has('cppaymethod')
        ? "UPPER(TRIM(COALESCE(cppaymethod, 'CASH')))"
        : "'CASH'";
      const channel = (expression: string) => `CASE
        WHEN ${expression} LIKE '%GCASH%' OR ${expression} LIKE '%MAYA%' OR ${expression} LIKE '%WALLET%' THEN 'E_WALLET'
        WHEN ${expression} LIKE '%BANK%' OR ${expression} LIKE '%TRANSFER%' THEN 'BANK'
        WHEN ${expression} LIKE '%CREDIT%' THEN 'CREDIT'
        WHEN ${expression} LIKE '%CASH%' THEN 'CASH'
        ELSE 'OTHER' END`;
      const [channelRows, statusRows, cashFlow] = await Promise.all([
        db.$queryRawUnsafe<PaymentChannelRow[]>(
          `WITH activity AS (
             SELECT ${channel("UPPER(TRIM(COALESCE(salespaym, 'CASH')))")} AS channel,
                    CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) AS salesTotal,
                    CAST(COALESCE(SUM(MAX(0, COALESCE(salestender, 0) - COALESCE(saleschange, 0))), 0) AS REAL) AS saleReceipts,
                    0 AS creditCollections
               FROM salestbl
              WHERE date(salesdate) BETWEEN date(?) AND date(?)
                AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
              GROUP BY channel
             UNION ALL
             SELECT ${channel(creditMethod)}, 0, 0,
                    CAST(COALESCE(SUM(cppay), 0) AS REAL)
               FROM creditpaymenttbl
              WHERE date(cppaydate) BETWEEN date(?) AND date(?)
              GROUP BY 1
           )
           SELECT channel,
                  CAST(COALESCE(SUM(salesTotal), 0) AS REAL) AS salesTotal,
                  CAST(COALESCE(SUM(saleReceipts), 0) AS REAL) AS saleReceipts,
                  CAST(COALESCE(SUM(creditCollections), 0) AS REAL) AS creditCollections
             FROM activity GROUP BY channel ORDER BY channel`,
          dates.from,
          dates.to,
          dates.from,
          dates.to,
        ),
        db.$queryRawUnsafe<
          Array<{
            status: string;
            saleCount: number;
            amount: number;
            balance: number;
          }>
        >(
          `SELECT CASE WHEN UPPER(TRIM(COALESCE(salestatus, ''))) = 'UNPAID' OR COALESCE(tenderbalance, 0) > 0 THEN 'UNPAID' ELSE 'PAID' END AS status,
                  CAST(COUNT(*) AS INTEGER) AS saleCount,
                  CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) AS amount,
                  CAST(COALESCE(SUM(MAX(0, COALESCE(tenderbalance, 0))), 0) AS REAL) AS balance
             FROM salestbl
            WHERE date(salesdate) BETWEEN date(?) AND date(?)
              AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
            GROUP BY status`,
          dates.from,
          dates.to,
        ),
        this.cashFlowTotals(db, dates),
      ]);
      const channels = channelRows.map((row) => ({
        ...row,
        salesTotal: this.amount(row.salesTotal),
        saleReceipts: this.amount(row.saleReceipts),
        creditCollections: this.amount(row.creditCollections),
        totalReceived:
          this.amount(row.saleReceipts) + this.amount(row.creditCollections),
      }));
      const paid = statusRows.find((row) => row.status === 'PAID');
      const unpaid = statusRows.find((row) => row.status === 'UNPAID');
      const saleReceipts = channels.reduce(
        (sum, row) => sum + row.saleReceipts,
        0,
      );
      const creditCollections = channels.reduce(
        (sum, row) => sum + row.creditCollections,
        0,
      );
      return {
        summary: {
          paidSales: this.amount(paid?.amount),
          paidSaleCount: Number(paid?.saleCount ?? 0),
          unpaidSales: this.amount(unpaid?.amount),
          unpaidSaleCount: Number(unpaid?.saleCount ?? 0),
          outstandingBalance: this.amount(unpaid?.balance),
          saleReceipts,
          creditCollections,
          totalReceived: saleReceipts + creditCollections,
          cashFlowReceipts: cashFlow.salesReceipts + cashFlow.creditCollections,
          reconciliationDifference:
            saleReceipts +
            creditCollections -
            (cashFlow.salesReceipts + cashFlow.creditCollections),
        },
        channels,
      };
    });
  }

  customerBalances(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: PagedReportQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const where = this.customerBalancesWhere(input);
      const [items, total] = await Promise.all([
        db.customer.findMany({
          where,
          orderBy: [{ balance: 'desc' }, { name: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        db.customer.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    });
  }

  cashFlow(user: AuthenticatedPortalUser, storeId: string, range: DateRange) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      return this.cashFlowTotals(db, range);
    });
  }

  cashFlowTransactions(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: CashFlowTransactionsQuery,
  ) {
    this.authorize(user, storeId);
    return this.withFreshness(storeId, async (db) => {
      const range = this.requiredDateRange(input);
      const sourceQuery = await this.cashFlowSourceQuery(
        db,
        input.source,
        range,
      );
      const offset = (input.page - 1) * input.pageSize;
      const [items, aggregate, summary] = await Promise.all([
        db.$queryRawUnsafe<CashFlowTransactionRow[]>(
          `SELECT * FROM (${sourceQuery.sql}) entries
           ORDER BY datetime(movementDate) DESC, id DESC
           LIMIT ? OFFSET ?`,
          ...sourceQuery.parameters,
          input.pageSize,
          offset,
        ),
        db.$queryRawUnsafe<Array<{ total: number; count: number }>>(
          `SELECT CAST(COALESCE(SUM(amount), 0) AS REAL) AS total,
                  CAST(COUNT(*) AS INTEGER) AS count
             FROM (${sourceQuery.sql}) entries`,
          ...sourceQuery.parameters,
        ),
        this.cashFlowTotals(db, range),
      ]);
      const sourceTotal = this.amount(aggregate[0]?.total);
      const summaryTotal = this.cashFlowSourceTotal(summary, input.source);
      return {
        source: input.source,
        label: this.cashFlowSourceLabel(input.source),
        direction: this.cashFlowSourceDirection(input.source),
        items: items.map((item) => ({
          ...item,
          id: Number(item.id),
          amount: this.amount(item.amount),
        })),
        total: Number(aggregate[0]?.count ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        sourceTotal,
        summaryTotal,
        reconciliationDifference: sourceTotal - summaryTotal,
      };
    });
  }

  private async cashFlowTotals(
    db: StorePrismaClient,
    range: DateRange,
  ): Promise<CashFlowTotals> {
    const from = range.from?.slice(0, 10) ?? '';
    const to = range.to?.slice(0, 10) ?? '';
    const rows = await db.$queryRawUnsafe<
      Array<{
        openingBalance: number;
        salesReceipts: number;
        creditCollections: number;
        capitalCashIn: number;
        pettyCashOut: number;
        salaryPaid: number;
        restockPayments: number;
      }>
    >(
      `WITH parameters AS (
        SELECT DATE(?) AS from_date, DATE(?) AS to_date
      ), movements AS (
        SELECT DATE(salesdate) AS movement_date,
               CAST(COALESCE(SUM(salestender - saleschange), 0) AS REAL) AS sales_receipts,
               0 AS credit_collections, 0 AS capital_cash_in, 0 AS petty_cash_out,
               0 AS salary_paid, 0 AS restock_payments
        FROM salestbl
        WHERE UPPER(COALESCE(salestatus, '')) <> 'CANCELLED'
        GROUP BY DATE(salesdate)
        UNION ALL
        SELECT DATE(cppaydate), 0, CAST(COALESCE(SUM(cppay), 0) AS REAL), 0, 0, 0, 0
        FROM creditpaymenttbl GROUP BY DATE(cppaydate)
        UNION ALL
        SELECT DATE(pettylogdate), 0, 0,
               CAST(COALESCE(SUM(CASE WHEN UPPER(COALESCE(pettylogtype, '')) = 'CASH IN' THEN pettylogamount ELSE 0 END), 0) AS REAL),
               CAST(COALESCE(SUM(CASE WHEN UPPER(COALESCE(pettylogtype, '')) = 'CASH OUT' THEN pettylogamount ELSE 0 END), 0) AS REAL),
               0, 0
        FROM pettylogstbl
        WHERE UPPER(COALESCE(pettyref, 'CONFIRMED')) <> 'CANCELLED'
        GROUP BY DATE(pettylogdate)
        UNION ALL
        SELECT DATE(COALESCE(salrefdate, saldate)), 0, 0, 0, 0,
               CAST(COALESCE(SUM(salpaid), 0) AS REAL), 0
        FROM salhistory GROUP BY DATE(COALESCE(salrefdate, saldate))
        UNION ALL
        SELECT DATE(payment.paid_at), 0, 0, 0, 0, 0,
               CAST(COALESCE(SUM(CASE WHEN UPPER(COALESCE(payment.payment_kind, 'PAYMENT')) = 'REFUND' THEN -payment.amount ELSE payment.amount END), 0) AS REAL)
        FROM supplier_restock_payments payment
        INNER JOIN pouttbl transfer ON transfer.poutid = payment.transfer_id
        WHERE UPPER(TRIM(COALESCE(transfer.pouttype, ''))) IN ('RESTOCK IN', 'W.RESTOCK IN')
        GROUP BY DATE(payment.paid_at)
      )
      SELECT
        CAST(COALESCE(SUM(CASE WHEN movement_date < parameters.from_date
          THEN sales_receipts + credit_collections + capital_cash_in - petty_cash_out - salary_paid - restock_payments ELSE 0 END), 0) AS REAL) AS openingBalance,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN sales_receipts ELSE 0 END), 0) AS REAL) AS salesReceipts,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN credit_collections ELSE 0 END), 0) AS REAL) AS creditCollections,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN capital_cash_in ELSE 0 END), 0) AS REAL) AS capitalCashIn,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN petty_cash_out ELSE 0 END), 0) AS REAL) AS pettyCashOut,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN salary_paid ELSE 0 END), 0) AS REAL) AS salaryPaid,
        CAST(COALESCE(SUM(CASE WHEN movement_date BETWEEN parameters.from_date AND parameters.to_date THEN restock_payments ELSE 0 END), 0) AS REAL) AS restockPayments
      FROM movements CROSS JOIN parameters
      WHERE movement_date IS NOT NULL AND movement_date <= parameters.to_date`,
      from,
      to,
    );
    const row = rows[0];
    const totals = {
      openingBalance: this.amount(row?.openingBalance),
      salesReceipts: this.amount(row?.salesReceipts),
      creditCollections: this.amount(row?.creditCollections),
      capitalCashIn: this.amount(row?.capitalCashIn),
      pettyCashOut: this.amount(row?.pettyCashOut),
      salaryPaid: this.amount(row?.salaryPaid),
      restockPayments: this.amount(row?.restockPayments),
    };
    const cashReceived =
      totals.salesReceipts + totals.creditCollections + totals.capitalCashIn;
    const cashPaid =
      totals.pettyCashOut + totals.salaryPaid + totals.restockPayments;
    return {
      ...totals,
      cashReceived,
      cashPaid,
      closingBalance: totals.openingBalance + cashReceived - cashPaid,
      netCashFlow: cashReceived - cashPaid,
    };
  }

  private async cashFlowSourceQuery(
    db: StorePrismaClient,
    source: CashFlowSource,
    range: { from: string; to: string },
  ): Promise<{ sql: string; parameters: [string, string] }> {
    if (source === 'SALES_RECEIPTS') {
      return {
        sql: `SELECT CAST(salesid AS INTEGER) AS id,
                     COALESCE(salesdate, '') AS movementDate,
                     TRIM(COALESCE(salesrefnum, '')) AS reference,
                     COALESCE(NULLIF(TRIM(salescust), ''), 'Walk-in customer') AS description,
                     TRIM(COALESCE(salespaym, '')) AS paymentMethod,
                     '' AS notes,
                     CAST(COALESCE(salestender - saleschange, 0) AS REAL) AS amount
                FROM salestbl
               WHERE UPPER(COALESCE(salestatus, '')) <> 'CANCELLED'
                 AND date(salesdate) BETWEEN date(?) AND date(?)`,
        parameters: [range.from, range.to],
      };
    }

    if (source === 'CREDIT_COLLECTIONS') {
      const columns = await this.tableColumns(db, 'creditpaymenttbl');
      const reference = columns.has('cprefnum')
        ? "TRIM(COALESCE(cp.cprefnum, ''))"
        : "''";
      const description = columns.has('cpcustname')
        ? "COALESCE(NULLIF(TRIM(cp.cpcustname), ''), 'Customer payment')"
        : "'Customer payment'";
      const method = columns.has('cppaymethod')
        ? "TRIM(COALESCE(cp.cppaymethod, ''))"
        : "''";
      return {
        sql: `SELECT CAST(cp.cpid AS INTEGER) AS id,
                     COALESCE(cp.cppaydate, '') AS movementDate,
                     ${reference} AS reference,
                     ${description} AS description,
                     ${method} AS paymentMethod,
                     '' AS notes,
                     CAST(COALESCE(cp.cppay, 0) AS REAL) AS amount
                FROM creditpaymenttbl cp
               WHERE date(cp.cppaydate) BETWEEN date(?) AND date(?)`,
        parameters: [range.from, range.to],
      };
    }

    if (source === 'CAPITAL_CASH_IN' || source === 'PETTY_CASH_OUT') {
      const columns = await this.tableColumns(db, 'pettylogstbl');
      const remarks = columns.has('pettylogremarks')
        ? "COALESCE(NULLIF(TRIM(pettylogremarks), ''), 'Petty cash entry')"
        : "'Petty cash entry'";
      const method = columns.has('pettypaymenthod')
        ? "TRIM(COALESCE(pettypaymenthod, ''))"
        : "''";
      const entryType = source === 'CAPITAL_CASH_IN' ? 'CASH IN' : 'CASH OUT';
      return {
        sql: `SELECT CAST(pettylogid AS INTEGER) AS id,
                     COALESCE(pettylogdate, '') AS movementDate,
                     'Petty cash #' || CAST(pettylogid AS TEXT) AS reference,
                     ${remarks} AS description,
                     ${method} AS paymentMethod,
                     '' AS notes,
                     CAST(COALESCE(pettylogamount, 0) AS REAL) AS amount
                FROM pettylogstbl
               WHERE UPPER(COALESCE(pettylogtype, '')) = '${entryType}'
                 AND UPPER(COALESCE(pettyref, 'CONFIRMED')) <> 'CANCELLED'
                 AND date(pettylogdate) BETWEEN date(?) AND date(?)`,
        parameters: [range.from, range.to],
      };
    }

    if (source === 'SALARY_PAID') {
      const columns = await this.tableColumns(db, 'salhistory');
      const reference = columns.has('salrefnum')
        ? "TRIM(COALESCE(salrefnum, ''))"
        : "'Salary #' || CAST(salhid AS TEXT)";
      const personnel = columns.has('salpersonel')
        ? "COALESCE(NULLIF(TRIM(salpersonel), ''), 'Personnel payment')"
        : "'Personnel payment'";
      const method = columns.has('salpaymethod')
        ? "TRIM(COALESCE(salpaymethod, ''))"
        : "''";
      const notes = columns.has('salremarks')
        ? "TRIM(COALESCE(salremarks, ''))"
        : "''";
      return {
        sql: `SELECT CAST(salhid AS INTEGER) AS id,
                     COALESCE(salrefdate, saldate, '') AS movementDate,
                     ${reference} AS reference,
                     ${personnel} AS description,
                     ${method} AS paymentMethod,
                     ${notes} AS notes,
                     CAST(COALESCE(salpaid, 0) AS REAL) AS amount
                FROM salhistory
               WHERE date(COALESCE(salrefdate, saldate)) BETWEEN date(?) AND date(?)`,
        parameters: [range.from, range.to],
      };
    }

    const paymentColumns = await this.tableColumns(
      db,
      'supplier_restock_payments',
    );
    const method = paymentColumns.has('payment_method')
      ? "TRIM(COALESCE(payment.payment_method, ''))"
      : "''";
    const paymentReference = paymentColumns.has('payment_reference')
      ? "TRIM(COALESCE(payment.payment_reference, ''))"
      : "''";
    const notes = paymentColumns.has('notes')
      ? "TRIM(COALESCE(payment.notes, ''))"
      : "''";
    return {
      sql: `SELECT CAST(payment.payment_id AS INTEGER) AS id,
                   COALESCE(payment.paid_at, '') AS movementDate,
                   COALESCE(NULLIF(${paymentReference}, ''), NULLIF(TRIM(transfer.poutrefnum), ''), 'Restock payment #' || CAST(payment.payment_id AS TEXT)) AS reference,
                   COALESCE(NULLIF(TRIM(transfer.pullsupplier), ''), 'Supplier payment') AS description,
                   ${method} AS paymentMethod,
                   ${notes} AS notes,
                   CAST(CASE WHEN UPPER(COALESCE(payment.payment_kind, 'PAYMENT')) = 'REFUND' THEN -payment.amount ELSE payment.amount END AS REAL) AS amount
              FROM supplier_restock_payments payment
              INNER JOIN pouttbl transfer ON transfer.poutid = payment.transfer_id
             WHERE UPPER(TRIM(COALESCE(transfer.pouttype, ''))) IN ('RESTOCK IN', 'W.RESTOCK IN')
               AND date(payment.paid_at) BETWEEN date(?) AND date(?)`,
      parameters: [range.from, range.to],
    };
  }

  private cashFlowSourceTotal(
    totals: CashFlowTotals,
    source: CashFlowSource,
  ): number {
    const values: Record<CashFlowSource, number> = {
      SALES_RECEIPTS: totals.salesReceipts,
      CREDIT_COLLECTIONS: totals.creditCollections,
      CAPITAL_CASH_IN: totals.capitalCashIn,
      PETTY_CASH_OUT: totals.pettyCashOut,
      SALARY_PAID: totals.salaryPaid,
      RESTOCK_PAYMENTS: totals.restockPayments,
    };
    return values[source];
  }

  private cashFlowSourceLabel(source: CashFlowSource): string {
    const labels: Record<CashFlowSource, string> = {
      SALES_RECEIPTS: 'Sales receipts',
      CREDIT_COLLECTIONS: 'Credit collections',
      CAPITAL_CASH_IN: 'Capital cash in',
      PETTY_CASH_OUT: 'Petty cash out',
      SALARY_PAID: 'Salary paid',
      RESTOCK_PAYMENTS: 'Restock payments',
    };
    return labels[source];
  }

  private cashFlowSourceDirection(source: CashFlowSource): 'IN' | 'OUT' {
    return ['SALES_RECEIPTS', 'CREDIT_COLLECTIONS', 'CAPITAL_CASH_IN'].includes(
      source,
    )
      ? 'IN'
      : 'OUT';
  }

  async exportReport(
    user: AuthenticatedPortalUser,
    storeId: string,
    report: string,
    range: ReportQuery,
  ) {
    this.authorize(user, storeId);
    if (!this.isExportReport(report)) {
      throw new BadRequestException('This report cannot be exported.');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, status: 'ACTIVE' },
      select: { code: true, name: true },
    });
    if (!store) throw new NotFoundException('Store was not found.');

    if (report === 'cash-flow') {
      const response = await this.cashFlow(user, storeId, range);
      const cash = response.data as CashFlowTotals;
      const dataset: CsvDataset = {
        headers: ['Cash flow item', 'Amount'],
        rows: [
          ['Opening balance', cash.openingBalance],
          ['Sales receipts', cash.salesReceipts],
          ['Credit collections', cash.creditCollections],
          ['Capital cash in', cash.capitalCashIn],
          ['Total cash received', cash.cashReceived],
          ['Petty cash out', cash.pettyCashOut],
          ['Salary paid', cash.salaryPaid],
          ['Restock payments', cash.restockPayments],
          ['Total cash paid', cash.cashPaid],
          ['Net cash flow', cash.netCashFlow],
          ['Closing cash position', cash.closingBalance],
        ],
      };
      return {
        ...response,
        data: this.exportPayload(
          store.name || store.code,
          report,
          range,
          dataset,
        ),
      };
    }

    const response = await this.withFreshness<CsvDataset>(
      storeId,
      async (db) => {
        if (report === 'customer-insights') {
          const dates = this.requiredDateRange(range);
          const search = range.search?.trim().toLowerCase();
          const rankBy = range.customerSort ?? 'SPEND';
          const items = (await this.customerInsightRows(db, dates))
            .filter(
              (row) =>
                !search ||
                row.name.toLowerCase().includes(search) ||
                row.contact.toLowerCase().includes(search),
            )
            .sort((left, right) => {
              const difference =
                rankBy === 'VISITS'
                  ? right.visitCount - left.visitCount
                  : rankBy === 'RECENT'
                    ? right.lastPurchaseDate.localeCompare(
                        left.lastPurchaseDate,
                      )
                    : rankBy === 'BALANCE'
                      ? right.balance - left.balance
                      : right.recordedSpend - left.recordedSpend;
              return difference === 0
                ? left.name.localeCompare(right.name)
                : difference;
            });
          return {
            headers: [
              'Rank',
              'Customer ID',
              'Customer',
              'Contact',
              'Visit count',
              'Recorded spend',
              'Average purchase',
              'Outstanding balance',
              'First purchase',
              'Last purchase',
            ],
            rows: items.map((item, index) => [
              index + 1,
              item.id,
              item.name,
              item.contact,
              item.visitCount,
              item.recordedSpend,
              item.averagePurchase,
              item.balance,
              item.firstPurchaseDate,
              item.lastPurchaseDate,
            ]),
          };
        }

        if (report === 'profitability') {
          const dates = this.requiredDateRange(range);
          const previousDates = this.previousDateRange(dates.from, dates.to);
          const [currentRows, previousRows] = await Promise.all([
            this.profitabilityRows(db, dates),
            this.profitabilityRows(db, previousDates),
          ]);
          const search = range.search?.trim().toLowerCase();
          const category = range.category?.trim();
          const previousByCode = new Map(
            previousRows.map((row) => [row.itemCode.trim().toLowerCase(), row]),
          );
          const rankBy = range.profitabilitySort ?? 'PROFIT';
          const items = currentRows
            .filter(
              (row) =>
                (!search ||
                  row.itemCode.toLowerCase().includes(search) ||
                  row.item.toLowerCase().includes(search) ||
                  row.category.toLowerCase().includes(search)) &&
                (!category || row.category === category),
            )
            .sort((left, right) => {
              const metric =
                rankBy === 'MARGIN'
                  ? 'recordedMarginPercent'
                  : rankBy === 'REVENUE'
                    ? 'revenue'
                    : 'recordedGrossProfit';
              return right[metric] - left[metric];
            });
          return {
            headers: [
              'Rank',
              'Code',
              'Product',
              'Category',
              'Quantity',
              'Revenue',
              'Recorded cost',
              'Recorded gross profit',
              'Recorded margin percent',
              'Cost coverage percent',
              'Missing cost lines',
              'Previous revenue',
              'Previous recorded gross profit',
              'Recorded profit change',
            ],
            rows: items.map((item, index) => {
              const prior = previousByCode.get(
                item.itemCode.trim().toLowerCase(),
              );
              const previousRevenue = prior?.revenue ?? 0;
              const previousProfit = prior?.recordedGrossProfit ?? 0;
              return [
                index + 1,
                item.itemCode,
                item.item,
                item.category,
                item.quantity,
                item.revenue,
                item.recordedCost,
                item.recordedGrossProfit,
                item.recordedMarginPercent,
                item.costCoveragePercent,
                item.missingCostLines,
                previousRevenue,
                previousProfit,
                item.recordedGrossProfit - previousProfit,
              ];
            }),
          };
        }

        if (report === 'inventory-forecast') {
          const dates = this.requiredDateRange(range);
          const forecast = await this.inventoryForecastRows(db, range, dates);
          const search = range.search?.trim().toLowerCase();
          const items = forecast.items.filter(
            (item) =>
              (!search ||
                item.code.toLowerCase().includes(search) ||
                item.item.toLowerCase().includes(search) ||
                item.category.toLowerCase().includes(search)) &&
              (!range.category?.trim() ||
                item.category === range.category.trim()) &&
              (!range.risk || item.risk === range.risk),
          );
          return {
            headers: [
              'Code',
              'Item',
              'Category',
              'Risk',
              'Store fill',
              'Warehouse fill',
              'Available stock',
              'Units sold',
              'Average daily sales',
              'Days remaining',
              `${forecast.forecastDays}-day demand`,
              'Suggested reorder',
              'Recorded unit cost',
              'Estimated reorder cost',
              'Last sold',
            ],
            rows: items.map((item) => [
              item.code,
              item.item,
              item.category,
              item.risk,
              item.storeFill,
              item.warehouseFill,
              item.availableStock,
              item.salesQuantity,
              item.averageDailySales,
              item.daysRemaining,
              item.projectedDemand,
              item.suggestedReorder,
              item.recordedCost,
              item.estimatedReorderCost,
              item.lastSoldAt,
            ]),
          };
        }

        if (report === 'sales') {
          const saleReferences = await this.saleReferencesForItem(
            db,
            range.itemCode,
          );
          const sales = await db.sale.findMany({
            where: this.salesWhere(range, saleReferences),
            orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
          });
          return {
            headers: [
              'Date',
              'Reference',
              'Customer',
              'Cashier',
              'Payment',
              'Payment type',
              'Status',
              'Item count',
              'Subtotal',
              'Discount',
              'Special discount',
              'Total',
              'Recorded cost',
              'Recorded gross profit',
            ],
            rows: sales.map((sale) => [
              sale.saleDate,
              sale.reference,
              sale.customer,
              sale.cashier,
              sale.payment,
              sale.paymentType,
              sale.status,
              sale.itemCount,
              sale.subtotal,
              sale.discount,
              sale.specialDiscount,
              sale.totalAmount,
              sale.totalCost,
              this.amount(sale.totalAmount) - this.amount(sale.totalCost),
            ]),
          };
        }

        if (report === 'inventory') {
          const items = await db.inventoryItem.findMany({
            where: this.inventoryWhere(db, range),
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
          });
          const prices = await this.inventoryPriceMap(
            db,
            items.map((item) => item.id),
          );
          return {
            headers: [
              'Code',
              'Item',
              'Brand',
              'Size',
              'Category',
              'Fill',
              'Empty',
              'Warehouse fill',
              'Warehouse empty',
              'Lent',
              'Recorded cost',
              'Refill price',
              'Non-refill price',
            ],
            rows: items.map((item) => [
              item.code,
              item.name,
              item.brand,
              item.size,
              item.category,
              item.fillQuantity,
              item.emptyQuantity,
              item.warehouseFill,
              item.warehouseEmpty,
              item.lentQuantity,
              item.cost,
              prices.get(item.id)?.refillPrice ?? null,
              prices.get(item.id)?.nonRefillPrice ?? null,
            ]),
          };
        }

        if (report === 'transfers') {
          const transfers = await db.transfer.findMany({
            where: this.transfersWhere(range),
            orderBy: [{ transferDate: 'desc' }, { id: 'desc' }],
          });
          return {
            headers: [
              'Date',
              'Reference',
              'Type',
              'Supplier',
              'Destination',
              'Status',
              'Payment status',
              'Quantity',
              'Total amount',
              'Restock price',
              'Encoder',
              'Notes',
            ],
            rows: transfers.map((transfer) => [
              transfer.transferDate,
              transfer.reference,
              transfer.type,
              transfer.supplier,
              transfer.destination,
              transfer.status,
              transfer.paymentStatus,
              transfer.totalQuantity,
              transfer.totalAmount,
              transfer.restockPrice,
              transfer.encoder,
              transfer.notes,
            ]),
          };
        }

        const customers = await db.customer.findMany({
          where: this.customerBalancesWhere(range),
          orderBy: [{ balance: 'desc' }, { name: 'asc' }],
        });
        return {
          headers: ['Customer', 'Contact', 'Status', 'Balance'],
          rows: customers.map((customer) => [
            customer.name,
            customer.contact,
            customer.status,
            customer.balance,
          ]),
        };
      },
    );

    return {
      ...response,
      data: this.exportPayload(
        store.name || store.code,
        report,
        range,
        response.data,
      ),
    };
  }

  private overviewMetrics(input: unknown): OverviewMetric[] {
    if (!Array.isArray(input)) return [...DEFAULT_OVERVIEW_METRICS];
    const valid = input.filter(
      (metric): metric is OverviewMetric =>
        typeof metric === 'string' &&
        DEFAULT_OVERVIEW_METRICS.includes(metric as OverviewMetric),
    );
    const unique = [...new Set(valid)];
    return unique.length ? unique : [...DEFAULT_OVERVIEW_METRICS];
  }

  private savedViewReport(report: string): (typeof SAVED_VIEW_REPORTS)[number] {
    if (
      !SAVED_VIEW_REPORTS.includes(
        report as (typeof SAVED_VIEW_REPORTS)[number],
      )
    ) {
      throw new BadRequestException('This report cannot be saved as a view.');
    }
    return report as (typeof SAVED_VIEW_REPORTS)[number];
  }

  private savedViewFilters(
    input: Record<string, unknown>,
  ): Record<string, string | number> {
    const filters: Record<string, string | number> = {};
    const stringKeys = [
      'search',
      'status',
      'payment',
      'itemCode',
      'category',
      'stockStatus',
      'risk',
      'profitabilitySort',
      'customerSort',
    ] as const;
    for (const key of stringKeys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim())
        filters[key] = value.trim().slice(0, 100);
    }
    const forecastDays = Number(input.forecastDays);
    if ([7, 14, 30].includes(forecastDays)) filters.forecastDays = forecastDays;
    return filters;
  }

  private authorize(user: AuthenticatedPortalUser, storeId: string): void {
    if (!user.storeIds.includes(storeId)) {
      throw new ForbiddenException('You do not have access to this store.');
    }
  }

  private salesWhere(
    input: ReportQuery,
    saleReferences?: string[],
  ): Prisma.SaleWhereInput {
    const search = input.search?.trim();
    return {
      saleDate: this.dateWhere(input),
      ...(input.itemCode?.trim()
        ? { reference: { in: saleReferences ?? [] } }
        : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search } },
              { customer: { contains: search } },
            ],
          }
        : {}),
      ...(input.status?.trim() ? { status: input.status.trim() } : {}),
      ...(input.payment?.trim() ? { payment: input.payment.trim() } : {}),
    };
  }

  private async saleReferencesForItem(
    db: StorePrismaClient,
    itemCode?: string,
  ): Promise<string[] | undefined> {
    const code = itemCode?.trim();
    if (!code) return undefined;
    const rows = await db.$queryRawUnsafe<Array<{ reference: string | null }>>(
      `SELECT DISTINCT screfnum AS reference
         FROM salescart
        WHERE screfnum IS NOT NULL
          AND LOWER(COALESCE(NULLIF(TRIM(scitemcode), ''), 'Uncoded item')) = LOWER(?)`,
      code,
    );
    return rows
      .map((row) => row.reference?.trim())
      .filter((reference): reference is string => Boolean(reference));
  }

  private async profitabilityRows(
    db: StorePrismaClient,
    range: { from: string; to: string },
  ): Promise<ProfitabilityRecord[]> {
    const rows = await db.$queryRawUnsafe<ProfitabilitySourceRow[]>(
      `WITH sold AS (
         SELECT LOWER(TRIM(COALESCE(line.scitemcode, ''))) AS item_key,
                COALESCE(NULLIF(TRIM(line.scitemcode), ''), 'Uncoded item') AS itemCode,
                COALESCE(NULLIF(TRIM(line.scitemdesc), ''), 'Unnamed item') AS item,
                CAST(COALESCE(SUM(line.scqty), 0) AS INTEGER) AS quantity,
                CAST(COALESCE(SUM(line.sctotal), 0) AS REAL) AS revenue,
                CAST(COALESCE(SUM(line.totalcost), 0) AS REAL) AS recordedCost,
                CAST(COUNT(*) AS INTEGER) AS lineCount,
                CAST(COALESCE(SUM(CASE WHEN COALESCE(line.sctotal, 0) > 0 AND (line.totalcost IS NULL OR line.totalcost <= 0) THEN 1 ELSE 0 END), 0) AS INTEGER) AS missingCostLines
           FROM salescart line
           INNER JOIN salestbl sale ON sale.salesrefnum = line.screfnum
          WHERE date(sale.salesdate) BETWEEN date(?) AND date(?)
            AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
            AND UPPER(TRIM(COALESCE(line.scstats, ''))) <> 'CANCELLED'
          GROUP BY item_key, itemCode, item
       )
       SELECT sold.itemCode, sold.item,
              COALESCE(NULLIF(TRIM(inventory.itemcategory), ''), 'Uncategorized') AS category,
              sold.quantity, sold.revenue, sold.recordedCost, sold.lineCount, sold.missingCostLines
         FROM sold
         LEFT JOIN inventorytbl inventory
           ON LOWER(TRIM(COALESCE(inventory.itemcode, ''))) = sold.item_key`,
      range.from,
      range.to,
    );
    return rows.map((row) => {
      const revenue = this.amount(row.revenue);
      const recordedCost = this.amount(row.recordedCost);
      const lineCount = Number(row.lineCount ?? 0);
      const missingCostLines = Number(row.missingCostLines ?? 0);
      const recordedGrossProfit = revenue - recordedCost;
      return {
        itemCode: row.itemCode,
        item: row.item,
        category: row.category,
        quantity: Number(row.quantity ?? 0),
        revenue,
        recordedCost,
        recordedGrossProfit,
        recordedMarginPercent:
          revenue === 0
            ? 0
            : Math.round((recordedGrossProfit / revenue) * 10_000) / 100,
        lineCount,
        missingCostLines,
        costCoveragePercent:
          lineCount === 0
            ? 100
            : Math.round(
                ((lineCount - missingCostLines) / lineCount) * 10_000,
              ) / 100,
      };
    });
  }

  private async customerInsightRows(
    db: StorePrismaClient,
    range: { from: string; to: string },
  ): Promise<CustomerInsightRow[]> {
    const rows = await db.$queryRawUnsafe<CustomerInsightRow[]>(
      `SELECT CAST(customer.custid AS INTEGER) AS id,
              TRIM(COALESCE(customer.custname, 'Unnamed customer')) AS name,
              TRIM(COALESCE(customer.custcontnum, '')) AS contact,
              CAST(COALESCE(customer.custbalance, 0) AS REAL) AS balance,
              TRIM(COALESCE(customer.custstatus, 'active')) AS status,
              CAST(COUNT(sale.salesid) AS INTEGER) AS visitCount,
              CAST(COALESCE(SUM(sale.salestotalamount), 0) AS REAL) AS recordedSpend,
              CAST(COALESCE(AVG(sale.salestotalamount), 0) AS REAL) AS averagePurchase,
              COALESCE(MIN(sale.salesdate), '') AS firstPurchaseDate,
              COALESCE(MAX(sale.salesdate), '') AS lastPurchaseDate
         FROM custinfo customer
         INNER JOIN salestbl sale
           ON CAST(COALESCE(sale.salescustid, 0) AS INTEGER) = customer.custid
          AND date(sale.salesdate) BETWEEN date(?) AND date(?)
          AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
        WHERE LOWER(TRIM(COALESCE(customer.custstatus, 'active'))) <> 'inactive'
        GROUP BY customer.custid, customer.custname, customer.custcontnum,
                 customer.custbalance, customer.custstatus`,
      range.from,
      range.to,
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      name: row.name || 'Unnamed customer',
      balance: this.amount(row.balance),
      visitCount: Number(row.visitCount ?? 0),
      recordedSpend: this.amount(row.recordedSpend),
      averagePurchase: this.amount(row.averagePurchase),
    }));
  }

  private profitabilitySummary(rows: ProfitabilityRecord[]) {
    const totals = rows.reduce(
      (summary, row) => ({
        quantity: summary.quantity + row.quantity,
        revenue: summary.revenue + row.revenue,
        recordedCost: summary.recordedCost + row.recordedCost,
        recordedGrossProfit:
          summary.recordedGrossProfit + row.recordedGrossProfit,
        lineCount: summary.lineCount + row.lineCount,
        missingCostLines: summary.missingCostLines + row.missingCostLines,
      }),
      {
        quantity: 0,
        revenue: 0,
        recordedCost: 0,
        recordedGrossProfit: 0,
        lineCount: 0,
        missingCostLines: 0,
      },
    );
    return {
      ...totals,
      recordedMarginPercent:
        totals.revenue === 0
          ? 0
          : Math.round((totals.recordedGrossProfit / totals.revenue) * 10_000) /
            100,
      costCoveragePercent:
        totals.lineCount === 0
          ? 100
          : Math.round(
              ((totals.lineCount - totals.missingCostLines) /
                totals.lineCount) *
                10_000,
            ) / 100,
      costDataComplete: totals.missingCostLines === 0,
    };
  }

  private profitabilityCategories(
    current: ProfitabilityRecord[],
    previous: ProfitabilityRecord[],
  ) {
    const summarize = (rows: ProfitabilityRecord[]) => {
      const grouped = new Map<string, ProfitabilityRecord[]>();
      for (const row of rows) {
        grouped.set(row.category, [...(grouped.get(row.category) ?? []), row]);
      }
      return new Map(
        [...grouped.entries()].map(([category, categoryRows]) => [
          category,
          this.profitabilitySummary(categoryRows),
        ]),
      );
    };
    const currentCategories = summarize(current);
    const previousCategories = summarize(previous);
    const names = new Set([
      ...currentCategories.keys(),
      ...previousCategories.keys(),
    ]);
    return [...names].map((category) => {
      const currentSummary =
        currentCategories.get(category) ?? this.profitabilitySummary([]);
      const previousSummary =
        previousCategories.get(category) ?? this.profitabilitySummary([]);
      return {
        category,
        ...currentSummary,
        previousRevenue: previousSummary.revenue,
        previousRecordedGrossProfit: previousSummary.recordedGrossProfit,
        previousRecordedMarginPercent: previousSummary.recordedMarginPercent,
        revenueChange: currentSummary.revenue - previousSummary.revenue,
        recordedGrossProfitChange:
          currentSummary.recordedGrossProfit -
          previousSummary.recordedGrossProfit,
        recordedMarginPointChange:
          Math.round(
            (currentSummary.recordedMarginPercent -
              previousSummary.recordedMarginPercent) *
              100,
          ) / 100,
      };
    });
  }

  private percentageChange(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return (
      Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100
    );
  }

  private inventoryWhere(
    db: StorePrismaClient,
    input: ReportQuery,
  ): Prisma.InventoryItemWhereInput {
    const search = input.search?.trim();
    const category = input.category?.trim();
    const stockStatus = input.stockStatus;
    const stockWhere: Prisma.InventoryItemWhereInput =
      stockStatus === 'OUT_OF_STOCK'
        ? { fillQuantity: { lte: 0 } }
        : stockStatus === 'CRITICAL'
          ? {
              fillQuantity: {
                gt: 0,
                lte: db.inventoryItem.fields.alertLevel,
              },
              alertLevel: { gt: 0 },
            }
          : stockStatus === 'HEALTHY'
            ? {
                OR: [
                  { alertLevel: { lte: 0 }, fillQuantity: { gt: 0 } },
                  {
                    fillQuantity: {
                      gt: db.inventoryItem.fields.alertLevel,
                    },
                  },
                ],
              }
            : {};
    return {
      ...stockWhere,
      ...(category ? { category: { equals: category } } : {}),
      ...(search
        ? {
            AND: [
              stockWhere,
              {
                OR: [
                  { name: { contains: search } },
                  { code: { contains: search } },
                  { category: { contains: search } },
                ],
              },
            ],
          }
        : {}),
    };
  }

  private async inventoryForecastRows(
    db: StorePrismaClient,
    input: Pick<InventoryForecastQuery, 'forecastDays'>,
    range: { from: string; to: string },
  ): Promise<{
    items: InventoryForecastRecord[];
    categories: string[];
    analysisDays: number;
    forecastDays: number;
    leadTimeDays: number;
  }> {
    const forecastDays = [7, 14, 30].includes(Number(input.forecastDays))
      ? Number(input.forecastDays)
      : 14;
    const leadTimeDays = 7;
    const analysisDays = this.daysBetween(range.from, range.to) + 1;
    const [inventory, sales] = await Promise.all([
      db.inventoryItem.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      db.$queryRawUnsafe<InventoryForecastSalesRow[]>(
        `SELECT LOWER(TRIM(COALESCE(line.scitemcode, ''))) AS itemCode,
                CAST(COALESCE(SUM(CASE WHEN COALESCE(line.scqty, 0) > 0 THEN line.scqty ELSE 0 END), 0) AS INTEGER) AS quantity,
                MAX(COALESCE(sale.salesdate, line.scdate, '')) AS lastSoldAt
           FROM salescart line
           INNER JOIN salestbl sale ON sale.salesrefnum = line.screfnum
          WHERE date(sale.salesdate) BETWEEN date(?) AND date(?)
            AND UPPER(TRIM(COALESCE(sale.salestatus, ''))) <> 'CANCELLED'
            AND UPPER(TRIM(COALESCE(line.scstats, ''))) <> 'CANCELLED'
          GROUP BY LOWER(TRIM(COALESCE(line.scitemcode, '')))`,
        range.from,
        range.to,
      ),
    ]);
    const salesByCode = new Map(
      sales.map((row) => [
        row.itemCode,
        {
          quantity: Number(row.quantity ?? 0),
          lastSoldAt: row.lastSoldAt?.trim() || null,
        },
      ]),
    );
    const riskOrder: Record<InventoryForecastRisk, number> = {
      OUT_OF_STOCK: 0,
      REORDER_NOW: 1,
      WATCH: 2,
      HEALTHY: 3,
      NO_RECENT_SALES: 4,
    };
    const items = inventory
      .map((item): InventoryForecastRecord => {
        const code = item.code?.trim() || '';
        const sold = code ? salesByCode.get(code.toLowerCase()) : undefined;
        const salesQuantity = sold?.quantity ?? 0;
        const averageDailySales = salesQuantity / analysisDays;
        const storeFill = Math.max(0, Number(item.fillQuantity ?? 0));
        const warehouseFill = Math.max(0, Number(item.warehouseFill ?? 0));
        const availableStock = storeFill + warehouseFill;
        const alertLevel = Math.max(0, Number(item.alertLevel ?? 0));
        const daysRemaining =
          averageDailySales > 0 ? availableStock / averageDailySales : null;
        const projectedDemand = Math.ceil(averageDailySales * forecastDays);
        const reorderPoint =
          Math.ceil(averageDailySales * leadTimeDays) + alertLevel;
        const suggestedReorder =
          averageDailySales > 0
            ? Math.max(
                0,
                Math.ceil(
                  averageDailySales * forecastDays +
                    alertLevel -
                    availableStock,
                ),
              )
            : 0;
        const risk: InventoryForecastRisk =
          availableStock <= 0
            ? 'OUT_OF_STOCK'
            : averageDailySales <= 0
              ? 'NO_RECENT_SALES'
              : availableStock <= reorderPoint
                ? 'REORDER_NOW'
                : availableStock <= projectedDemand + alertLevel
                  ? 'WATCH'
                  : 'HEALTHY';
        const recordedCost = this.amount(item.cost);
        return {
          id: item.id,
          code,
          item:
            item.name?.trim() || item.brand?.trim() || code || 'Unnamed item',
          category: item.category?.trim() || 'Uncategorized',
          storeFill,
          warehouseFill,
          availableStock,
          alertLevel,
          recordedCost,
          salesQuantity,
          averageDailySales: Math.round(averageDailySales * 100) / 100,
          daysRemaining:
            daysRemaining === null ? null : Math.round(daysRemaining * 10) / 10,
          projectedDemand,
          suggestedReorder,
          estimatedReorderCost: this.amount(suggestedReorder * recordedCost),
          lastSoldAt: sold?.lastSoldAt ?? null,
          risk,
        };
      })
      .sort((left, right) => {
        const riskDifference = riskOrder[left.risk] - riskOrder[right.risk];
        if (riskDifference !== 0) return riskDifference;
        const leftDays = left.daysRemaining ?? Number.POSITIVE_INFINITY;
        const rightDays = right.daysRemaining ?? Number.POSITIVE_INFINITY;
        return leftDays === rightDays
          ? left.item.localeCompare(right.item)
          : leftDays - rightDays;
      });
    return {
      items,
      categories: this.stringOptions(inventory.map((item) => item.category)),
      analysisDays,
      forecastDays,
      leadTimeDays,
    };
  }

  private transfersWhere(input: ReportQuery): Prisma.TransferWhereInput {
    const search = input.search?.trim();
    return {
      transferDate: this.dateWhere(input),
      ...(search
        ? {
            OR: [
              { reference: { contains: search } },
              { supplier: { contains: search } },
              { type: { contains: search } },
            ],
          }
        : {}),
    };
  }

  private customerBalancesWhere(input: ReportQuery): Prisma.CustomerWhereInput {
    const search = input.search?.trim();
    return {
      balance: { gt: 0 },
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { contact: { contains: search } },
            ],
          }
        : {}),
    };
  }

  private stringOptions(values: Array<string | null>): string[] {
    const options = new Map<string, string>();
    for (const value of values) {
      const label = value?.trim() ?? '';
      if (!label) continue;
      const key = label.toLocaleLowerCase();
      if (!options.has(key)) options.set(key, label);
    }
    return [...options.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    );
  }

  private portalActivityEvent(
    row: {
      id: string;
      action: string;
      metadata: unknown;
      createdAt: Date;
    },
    storeNames: Map<string, string>,
  ) {
    const metadata =
      row.metadata &&
      typeof row.metadata === 'object' &&
      !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const storeId =
      typeof metadata.storeId === 'string' && storeNames.has(metadata.storeId)
        ? metadata.storeId
        : null;
    const storeName = storeId ? (storeNames.get(storeId) ?? null) : null;
    const deviceName = this.safeActivityLabel(
      metadata.deviceName,
      'Unknown browser',
    );
    const viewName = this.safeActivityLabel(
      metadata.viewName,
      'Saved report view',
    );
    const month = this.safeActivityLabel(metadata.month, 'the selected month');
    const frequency =
      this.safeActivityLabel(metadata.frequency, 'report').toLowerCase() ===
      'weekly'
        ? 'Weekly'
        : 'Daily';
    const count = Math.max(0, Number(metadata.count ?? 0));
    const schemaVersion = Number(metadata.schemaVersion ?? 0);
    const definitions: Record<
      string,
      {
        category: PortalActivityAction;
        status: 'SUCCESS' | 'INFO' | 'WARNING';
        title: string;
        detail: string;
        actor: string;
      }
    > = {
      'portal.account_activated': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Portal account activated',
        detail: 'The owner portal account completed activation.',
        actor: 'You',
      },
      'portal.login_succeeded': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Signed in',
        detail: `A portal session was opened from ${deviceName}.`,
        actor: 'You',
      },
      'portal.logged_out': {
        category: 'SECURITY',
        status: 'INFO',
        title: 'Signed out',
        detail: `A portal session on ${deviceName} was closed.`,
        actor: 'You',
      },
      'portal.password_changed': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Password changed',
        detail:
          'The password was changed and all browser sessions were revoked.',
        actor: 'You',
      },
      'portal.password_reset_completed': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Password reset completed',
        detail:
          'A one-time reset token was used and existing sessions were revoked.',
        actor: 'You',
      },
      'portal.session_revoked': {
        category: 'SECURITY',
        status: 'INFO',
        title: 'Browser session revoked',
        detail: 'Access for one browser session was removed.',
        actor: 'You',
      },
      'portal.other_sessions_revoked': {
        category: 'SECURITY',
        status: 'INFO',
        title: 'Other browser sessions revoked',
        detail: `${count} other ${count === 1 ? 'session was' : 'sessions were'} signed out.`,
        actor: 'You',
      },
      'portal.email_verified': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Report email verified',
        detail: 'The portal email address was verified for scheduled reports.',
        actor: 'You',
      },
      'portal.user_enabled': {
        category: 'SECURITY',
        status: 'SUCCESS',
        title: 'Portal access enabled',
        detail: 'A POS administrator enabled this portal account.',
        actor: 'POS administrator',
      },
      'portal.user_disabled': {
        category: 'SECURITY',
        status: 'WARNING',
        title: 'Portal access disabled',
        detail: 'A POS administrator disabled this portal account.',
        actor: 'POS administrator',
      },
      'sync.snapshot_activated': {
        category: 'STORE_SYNC',
        status: 'SUCCESS',
        title: 'Store data synchronized',
        detail: schemaVersion
          ? `A new reporting snapshot using schema ${schemaVersion} became active.`
          : 'A new reporting snapshot became active.',
        actor: 'POS device',
      },
      'sync.snapshot_restored': {
        category: 'STORE_SYNC',
        status: 'WARNING',
        title: 'Previous snapshot restored',
        detail:
          'A retained store snapshot was restored as the active reporting source.',
        actor: 'POS device',
      },
      'portal.overview_preferences_updated': {
        category: 'SETTINGS',
        status: 'INFO',
        title: 'Overview metrics updated',
        detail: 'The selected Overview metrics and their order were changed.',
        actor: 'You',
      },
      'portal.saved_view_saved': {
        category: 'SETTINGS',
        status: 'INFO',
        title: 'Report view saved',
        detail: `${viewName} was saved with its report context and filters.`,
        actor: 'You',
      },
      'portal.saved_view_deleted': {
        category: 'SETTINGS',
        status: 'INFO',
        title: 'Saved view deleted',
        detail: 'A saved report view was removed.',
        actor: 'You',
      },
      'portal.preferences_reset': {
        category: 'SETTINGS',
        status: 'WARNING',
        title: 'Dashboard preferences reset',
        detail: 'Overview metrics were restored and saved views were removed.',
        actor: 'You',
      },
      'portal.sales_target_updated': {
        category: 'SETTINGS',
        status: 'INFO',
        title: 'Sales targets updated',
        detail: `Monthly targets for ${month} were updated.`,
        actor: 'You',
      },
      'portal.alert_dismissed': {
        category: 'SETTINGS',
        status: 'INFO',
        title: 'Owner alert dismissed',
        detail: 'An informational owner alert was dismissed.',
        actor: 'You',
      },
      'portal.report_schedule_enabled': {
        category: 'REPORTING',
        status: 'SUCCESS',
        title: `${frequency} report enabled`,
        detail: `${frequency} summary delivery was enabled for this store.`,
        actor: 'You',
      },
      'portal.report_schedule_disabled': {
        category: 'REPORTING',
        status: 'INFO',
        title: `${frequency} report disabled`,
        detail: `${frequency} summary delivery was disabled for this store.`,
        actor: 'You',
      },
      'backup.platform_passed': {
        category: 'BACKUP',
        status: 'SUCCESS',
        title: 'Platform backup completed',
        detail:
          'Portal metadata and synchronized store snapshots were backed up.',
        actor: 'Platform',
      },
      'backup.platform_failed': {
        category: 'BACKUP',
        status: 'WARNING',
        title: 'Platform backup failed',
        detail:
          'The backup did not complete. Review the protected server logs.',
        actor: 'Platform',
      },
      'backup.restore_drill_passed': {
        category: 'BACKUP',
        status: 'SUCCESS',
        title: 'Restore drill passed',
        detail:
          'The latest backup restored successfully and report totals were verified.',
        actor: 'Platform',
      },
      'backup.restore_drill_failed': {
        category: 'BACKUP',
        status: 'WARNING',
        title: 'Restore drill failed',
        detail:
          'The recovery check did not complete. Review the protected server logs.',
        actor: 'Platform',
      },
    };
    const event = definitions[row.action] ?? {
      category: 'SETTINGS' as const,
      status: 'INFO' as const,
      title: 'Portal activity recorded',
      detail: 'A portal setting was changed.',
      actor: 'Portal',
    };
    return {
      id: row.id,
      occurredAt: row.createdAt.toISOString(),
      action: event.category,
      status: event.status,
      title: event.title,
      detail: event.detail,
      actor: event.actor,
      storeId,
      storeName,
    };
  }

  private safeActivityLabel(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const label = value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 100);
    return label || fallback;
  }

  private async recentCollections(
    db: StorePrismaClient,
    asOf: string,
    limit: number,
  ) {
    const columns = await this.tableColumns(db, 'creditpaymenttbl');
    const reference = columns.has('cprefnum')
      ? "TRIM(COALESCE(cp.cprefnum, ''))"
      : "''";
    const customerName = columns.has('cpcustname')
      ? "NULLIF(TRIM(cp.cpcustname), '')"
      : 'NULL';
    const customerId = columns.has('cpcustid')
      ? 'CAST(COALESCE(cp.cpcustid, s.salescustid, 0) AS INTEGER)'
      : 'CAST(COALESCE(s.salescustid, 0) AS INTEGER)';
    const paymentMethod = columns.has('cppaymethod')
      ? "TRIM(COALESCE(cp.cppaymethod, ''))"
      : "''";
    const remainingBalance = columns.has('cprembal')
      ? 'CAST(COALESCE(cp.cprembal, 0) AS REAL)'
      : '0';
    const join = columns.has('cprefnum')
      ? 'LEFT JOIN salestbl s ON s.salesrefnum = cp.cprefnum'
      : 'LEFT JOIN salestbl s ON 1 = 0';
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: number;
        reference: string;
        customerId: number;
        customer: string;
        amount: number;
        paymentDate: string;
        paymentMethod: string;
        remainingBalance: number;
      }>
    >(
      `SELECT cp.cpid AS id, ${reference} AS reference,
              ${customerId} AS customerId,
              COALESCE(${customerName}, NULLIF(TRIM(c.custname), ''), NULLIF(TRIM(s.salescust), ''), 'Customer') AS customer,
              CAST(COALESCE(cp.cppay, 0) AS REAL) AS amount,
              COALESCE(cp.cppaydate, '') AS paymentDate,
              ${paymentMethod} AS paymentMethod,
              ${remainingBalance} AS remainingBalance
         FROM creditpaymenttbl cp
         ${join}
         LEFT JOIN custinfo c ON c.custid = ${customerId}
        WHERE date(cp.cppaydate) <= date(?)
        ORDER BY datetime(cp.cppaydate) DESC, cp.cpid DESC
        LIMIT ?`,
      asOf,
      limit,
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      customerId: Number(row.customerId),
      amount: this.amount(row.amount),
      remainingBalance: this.amount(row.remainingBalance),
    }));
  }

  private async customerCollections(
    db: StorePrismaClient,
    customerId: number,
    limit: number,
  ) {
    const columns = await this.tableColumns(db, 'creditpaymenttbl');
    const hasReference = columns.has('cprefnum');
    const reference = hasReference ? "TRIM(COALESCE(cp.cprefnum, ''))" : "''";
    const paymentMethod = columns.has('cppaymethod')
      ? "TRIM(COALESCE(cp.cppaymethod, ''))"
      : "''";
    const balanceBefore = columns.has('cpbalance')
      ? 'CAST(COALESCE(cp.cpbalance, 0) AS REAL)'
      : '0';
    const balanceAfter = columns.has('cprembal')
      ? 'CAST(COALESCE(cp.cprembal, 0) AS REAL)'
      : '0';
    const join = hasReference
      ? 'LEFT JOIN salestbl s ON s.salesrefnum = cp.cprefnum'
      : 'LEFT JOIN salestbl s ON 1 = 0';
    const where = columns.has('cpcustid')
      ? 'CAST(COALESCE(cp.cpcustid, 0) AS INTEGER) = ? OR CAST(COALESCE(s.salescustid, 0) AS INTEGER) = ?'
      : 'CAST(COALESCE(s.salescustid, 0) AS INTEGER) = ?';
    const parameters = columns.has('cpcustid')
      ? [customerId, customerId, limit]
      : [customerId, limit];
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: number;
        reference: string;
        amount: number;
        paymentDate: string;
        paymentMethod: string;
        balanceBefore: number;
        balanceAfter: number;
      }>
    >(
      `SELECT cp.cpid AS id, ${reference} AS reference,
              CAST(COALESCE(cp.cppay, 0) AS REAL) AS amount,
              COALESCE(cp.cppaydate, '') AS paymentDate,
              ${paymentMethod} AS paymentMethod,
              ${balanceBefore} AS balanceBefore,
              ${balanceAfter} AS balanceAfter
         FROM creditpaymenttbl cp
         ${join}
        WHERE (${where})
        ORDER BY datetime(cp.cppaydate) DESC, cp.cpid DESC
        LIMIT ?`,
      ...parameters,
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      amount: this.amount(row.amount),
      balanceBefore: this.amount(row.balanceBefore),
      balanceAfter: this.amount(row.balanceAfter),
    }));
  }

  private async tableColumns(
    db: StorePrismaClient,
    table: string,
  ): Promise<Set<string>> {
    const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM pragma_table_info('${table}')`,
    );
    return new Set(rows.map((row) => row.name.toLowerCase()));
  }

  private async inventoryPriceMap(
    db: StorePrismaClient,
    itemIds: number[],
  ): Promise<Map<number, { refillPrice: number; nonRefillPrice: number }>> {
    const prices = new Map<
      number,
      { refillPrice: number; nonRefillPrice: number }
    >();
    if (!itemIds.length || !(await this.tableExists(db, 'pricelisttbl')))
      return prices;
    const columns = await this.tableColumns(db, 'pricelisttbl');
    if (
      !columns.has('itemid') ||
      !columns.has('refill') ||
      !columns.has('non_refill')
    )
      return prices;
    const placeholders = itemIds.map(() => '?').join(', ');
    const rows = await db.$queryRawUnsafe<InventoryPriceRow[]>(
      `SELECT CAST(itemid AS INTEGER) AS itemId,
              CAST(COALESCE(Refill, 0) AS REAL) AS refillPrice,
              CAST(COALESCE(Non_Refill, 0) AS REAL) AS nonRefillPrice
         FROM pricelisttbl
        WHERE itemid IN (${placeholders})`,
      ...itemIds,
    );
    for (const row of rows) {
      prices.set(Number(row.itemId), {
        refillPrice: this.amount(row.refillPrice),
        nonRefillPrice: this.amount(row.nonRefillPrice),
      });
    }
    return prices;
  }

  private async tableExists(
    db: StorePrismaClient,
    table: string,
  ): Promise<boolean> {
    const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
      table,
    );
    return Number(rows[0]?.count ?? 0) > 0;
  }

  private async requireFeatureMod(
    db: StorePrismaClient,
    storeId: string,
    key: string,
    label: string,
  ): Promise<void> {
    const subscriptionFeatures = await this.subscriptionFeatureMods(storeId);
    if (subscriptionFeatures[key] === true) return;
    if (subscriptionFeatures[key] === false) {
      throw new NotFoundException(`${label} is not enabled for this store.`);
    }
    if (!(await this.tableExists(db, 'owner_feature_mods'))) {
      throw new NotFoundException(
        `${label} is not available in this synchronized snapshot.`,
      );
    }
    const rows = await db.$queryRawUnsafe<Array<{ enabled: number }>>(
      'SELECT CAST(enabled AS INTEGER) AS enabled FROM owner_feature_mods WHERE feature_key = ? LIMIT 1',
      key,
    );
    if (Number(rows[0]?.enabled ?? 0) !== 1) {
      throw new NotFoundException(`${label} is not enabled for this store.`);
    }
  }

  private async subscriptionFeatureMods(
    storeId: string,
  ): Promise<Record<string, boolean>> {
    type DeviceLookup = {
      findFirst(input: unknown): Promise<{
        subscription: { entitlements: unknown } | null;
      } | null>;
    };
    const deviceRepository = (
      this.prisma as unknown as { device?: DeviceLookup }
    ).device;
    if (!deviceRepository) return {};
    const device = await deviceRepository.findFirst({
      where: {
        storeId,
        status: 'ACTIVE',
        subscription: {
          is: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } },
        },
      },
      select: { subscription: { select: { entitlements: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const entitlements = device?.subscription?.entitlements;
    if (
      !entitlements ||
      typeof entitlements !== 'object' ||
      Array.isArray(entitlements)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(entitlements).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  }

  private inventoryStockStatus(item: {
    fillQuantity: number | null;
    alertLevel: number | null;
  }): 'OUT_OF_STOCK' | 'CRITICAL' | 'HEALTHY' {
    const fill = Number(item.fillQuantity ?? 0);
    const alert = Number(item.alertLevel ?? 0);
    if (fill <= 0) return 'OUT_OF_STOCK';
    if (alert > 0 && fill <= alert) return 'CRITICAL';
    return 'HEALTHY';
  }

  private requiredDateRange(input: DateRange): { from: string; to: string } {
    const from = input.from?.slice(0, 10) ?? '';
    const to = input.to?.slice(0, 10) ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('A valid from and to date are required.');
    }
    if (from > to) {
      throw new BadRequestException(
        'The from date cannot be after the to date.',
      );
    }
    return { from, to };
  }

  private salesTargetMonth(month: string): {
    month: string;
    from: string;
    to: string;
    totalDays: number;
  } {
    const normalized = month?.trim() ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
      throw new BadRequestException('A valid target month is required.');
    }
    const [year, monthNumber] = normalized.split('-').map(Number);
    if (year < 2000 || year > 2100) {
      throw new BadRequestException(
        'The target month must be between 2000 and 2100.',
      );
    }
    const totalDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      month: normalized,
      from: `${normalized}-01`,
      to: `${normalized}-${String(totalDays).padStart(2, '0')}`,
      totalDays,
    };
  }

  private validTargetAmount(value: number, label: string): number {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999.99) {
      throw new BadRequestException(
        `${label} must be a valid non-negative amount.`,
      );
    }
    return Math.round(amount * 100) / 100;
  }

  private targetProgress(actual: number, target: number): number {
    if (target <= 0) return 0;
    return Math.round((actual / target) * 10_000) / 100;
  }

  private salesTargetPace(
    period: { month: string; totalDays: number },
    timezone: string,
    grossSales: number,
    recordedGrossProfit: number,
    salesTarget: number,
    recordedGrossProfitTarget: number,
  ) {
    const today = this.localDate(new Date(), timezone);
    const currentMonth = today.slice(0, 7);
    const status =
      period.month < currentMonth
        ? ('COMPLETE' as const)
        : period.month > currentMonth
          ? ('UPCOMING' as const)
          : ('ACTIVE' as const);
    const elapsedDays =
      status === 'COMPLETE'
        ? period.totalDays
        : status === 'UPCOMING'
          ? 0
          : Math.min(period.totalDays, Number(today.slice(8, 10)));
    const remainingDays = Math.max(0, period.totalDays - elapsedDays);
    const paceDivisor = remainingDays || 1;
    const projectedSales =
      status === 'UPCOMING' || elapsedDays === 0
        ? 0
        : status === 'COMPLETE'
          ? grossSales
          : (grossSales / elapsedDays) * period.totalDays;
    const projectedRecordedGrossProfit =
      status === 'UPCOMING' || elapsedDays === 0
        ? 0
        : status === 'COMPLETE'
          ? recordedGrossProfit
          : (recordedGrossProfit / elapsedDays) * period.totalDays;
    return {
      status,
      totalDays: period.totalDays,
      elapsedDays,
      remainingDays,
      expectedProgressPercent:
        Math.round((elapsedDays / period.totalDays) * 10_000) / 100,
      salesRemaining: Math.max(0, salesTarget - grossSales),
      recordedGrossProfitRemaining: Math.max(
        0,
        recordedGrossProfitTarget - recordedGrossProfit,
      ),
      salesRequiredPerDay:
        remainingDays > 0
          ? Math.max(0, salesTarget - grossSales) / paceDivisor
          : 0,
      recordedGrossProfitRequiredPerDay:
        remainingDays > 0
          ? Math.max(0, recordedGrossProfitTarget - recordedGrossProfit) /
            paceDivisor
          : 0,
      projectedSales: this.amount(projectedSales),
      projectedRecordedGrossProfit: this.amount(projectedRecordedGrossProfit),
    };
  }

  private localDate(date: Date, timezone: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const value = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? '';
      return `${value('year')}-${value('month')}-${value('day')}`;
    } catch {
      return this.dateKey(date);
    }
  }

  private previousDateRange(
    from: string,
    to: string,
  ): { from: string; to: string } {
    const days = this.daysBetween(from, to) + 1;
    const previousTo = this.addDays(from, -1);
    return {
      from: this.addDays(previousTo, -(days - 1)),
      to: previousTo,
    };
  }

  private salesPeriodMetrics(
    range: { from: string; to: string },
    sum: SalesAggregateSum,
    transactionCount: number,
    salesMissingCostCount: number,
  ) {
    const grossSales = this.amount(sum.totalAmount);
    const costOfGoods = this.amount(sum.totalCost);
    const salesWithRecordedCost = Math.max(
      0,
      transactionCount - salesMissingCostCount,
    );
    return {
      ...range,
      grossSales,
      transactionCount,
      averageSaleValue:
        transactionCount > 0 ? grossSales / transactionCount : 0,
      discounts: this.amount(sum.discount) + this.amount(sum.specialDiscount),
      costOfGoods,
      grossProfit: grossSales - costOfGoods,
      salesWithRecordedCost,
      salesMissingCostCount,
      costCoveragePercent:
        transactionCount === 0
          ? 100
          : Math.round((salesWithRecordedCost / transactionCount) * 10_000) /
            100,
      profitDataComplete: salesMissingCostCount === 0,
    };
  }

  private trendRows(
    db: StorePrismaClient,
    from: string,
    to: string,
    grouping: SalesTrendGrouping,
  ): Promise<TrendRow[]> {
    const bucketExpression = {
      day: 'date(salesdate)',
      week: "date(salesdate, printf('-%d days', (CAST(strftime('%w', salesdate) AS INTEGER) + 6) % 7))",
      month: "strftime('%Y-%m-01', salesdate)",
    }[grouping];
    return db.$queryRawUnsafe<TrendRow[]>(
      `SELECT ${bucketExpression} AS bucket,
              CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) AS grossSales,
              CAST(COUNT(*) AS INTEGER) AS transactionCount,
              CAST(COALESCE(SUM(COALESCE(salesdisc, 0) + COALESCE(specialdisc, 0)), 0) AS REAL) AS discounts,
              CAST(COALESCE(SUM(salestotalcost), 0) AS REAL) AS costOfGoods,
              CAST(COALESCE(SUM(CASE
                WHEN COALESCE(salestotalamount, 0) > 0
                 AND (salestotalcost IS NULL OR salestotalcost <= 0)
                THEN 1 ELSE 0 END), 0) AS INTEGER) AS salesMissingCostCount
         FROM salestbl
        WHERE date(salesdate) BETWEEN date(?) AND date(?)
          AND UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
        GROUP BY ${bucketExpression}
        ORDER BY ${bucketExpression}`,
      from,
      to,
    );
  }

  private fillTrendPoints(
    from: string,
    to: string,
    grouping: SalesTrendGrouping,
    rows: TrendRow[],
  ) {
    const values = new Map(rows.map((row) => [row.bucket, row]));
    const points = [];
    let cursor = this.bucketStart(from, grouping);
    while (cursor <= to) {
      const row = values.get(cursor);
      const grossSales = this.amount(row?.grossSales);
      const costOfGoods = this.amount(row?.costOfGoods);
      points.push({
        key: cursor,
        label: this.trendLabel(cursor, grouping),
        grossSales,
        transactionCount: Number(row?.transactionCount ?? 0),
        discounts: this.amount(row?.discounts),
        costOfGoods,
        grossProfit: grossSales - costOfGoods,
        salesMissingCostCount: Number(row?.salesMissingCostCount ?? 0),
      });
      cursor = this.nextBucket(cursor, grouping);
    }
    return points;
  }

  private bucketStart(value: string, grouping: SalesTrendGrouping): string {
    const date = this.utcDate(value);
    if (grouping === 'week') {
      const mondayOffset = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - mondayOffset);
    } else if (grouping === 'month') {
      date.setUTCDate(1);
    }
    return this.dateKey(date);
  }

  private nextBucket(value: string, grouping: SalesTrendGrouping): string {
    const date = this.utcDate(value);
    if (grouping === 'day') date.setUTCDate(date.getUTCDate() + 1);
    if (grouping === 'week') date.setUTCDate(date.getUTCDate() + 7);
    if (grouping === 'month') date.setUTCMonth(date.getUTCMonth() + 1, 1);
    return this.dateKey(date);
  }

  private trendLabel(value: string, grouping: SalesTrendGrouping): string {
    const date = this.utcDate(value);
    const options: Intl.DateTimeFormatOptions =
      grouping === 'month'
        ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', timeZone: 'UTC' };
    const label = new Intl.DateTimeFormat('en-PH', options).format(date);
    return grouping === 'week' ? `Week of ${label}` : label;
  }

  private daysBetween(from: string, to: string): number {
    return Math.round(
      (this.utcDate(to).getTime() - this.utcDate(from).getTime()) / 86_400_000,
    );
  }

  private addDays(value: string, days: number): string {
    const date = this.utcDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return this.dateKey(date);
  }

  private utcDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private isExportReport(report: string): report is ExportReport {
    return [
      'sales',
      'inventory',
      'inventory-forecast',
      'profitability',
      'customer-insights',
      'transfers',
      'customer-balances',
      'cash-flow',
    ].includes(report);
  }

  private exportPayload(
    storeName: string,
    report: ExportReport,
    range: DateRange,
    dataset: CsvDataset,
  ) {
    const from = range.from?.slice(0, 10) || 'all';
    const to = range.to?.slice(0, 10) || 'all';
    const store = this.fileSegment(storeName) || 'store';
    return {
      fileName: `${store}-${report}-${from}-to-${to}.csv`,
      content: this.csv(dataset),
      rowCount: dataset.rows.length,
    };
  }

  private csv(dataset: CsvDataset): string {
    const lines = [dataset.headers, ...dataset.rows].map((row) =>
      row.map((value) => this.csvCell(value)).join(','),
    );
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private csvCell(value: CsvValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number')
      return Number.isFinite(value) ? String(value) : '';
    let text = value;
    if (['=', '+', '-', '@'].includes(text.trimStart().charAt(0)))
      text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  private fileSegment(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  private async backupHealthAlerts(): Promise<OwnerAlert[]> {
    const root = resolve(
      this.config.get<string>('PLATFORM_BACKUP_ROOT', './backups'),
    );
    let health: PlatformBackupHealth;
    try {
      health = JSON.parse(
        await readFile(resolve(root, 'health.json'), 'utf8'),
      ) as PlatformBackupHealth;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return [
        {
          id: 'backup-health-unreadable',
          storeId: 'ALL',
          storeName: 'Owner platform',
          severity: 'HIGH',
          type: 'BACKUP',
          title: 'Backup health could not be verified',
          detail:
            'The backup health record is unreadable. Review the server backup logs.',
          dismissible: false,
        },
      ];
    }

    const alerts: OwnerAlert[] = [];
    const operations = [
      {
        key: 'platformBackup' as const,
        label: 'Platform backup',
      },
      {
        key: 'restoreDrill' as const,
        label: 'Restore drill',
      },
    ];
    for (const operation of operations) {
      const record = health[operation.key];
      if (!record?.status) continue;
      const checkedAt = Date.parse(record.checkedAt ?? '');
      const stalled =
        record.status === 'RUNNING' &&
        (!Number.isFinite(checkedAt) || Date.now() - checkedAt >= 21_600_000);
      if (record.status !== 'FAIL' && !stalled) continue;
      const timestamp = Number.isFinite(checkedAt)
        ? new Date(checkedAt).toISOString()
        : 'an unknown time';
      alerts.push({
        id: `backup-${operation.key}-${record.checkedAt ?? 'unknown'}`,
        storeId: 'ALL',
        storeName: 'Owner platform',
        severity: 'HIGH',
        type: 'BACKUP',
        title: stalled
          ? `${operation.label} did not finish`
          : `${operation.label} failed`,
        detail: stalled
          ? `The operation has remained incomplete since ${timestamp}. Review the server backup logs.`
          : `The last attempt failed at ${timestamp}. Review the server backup logs.`,
        dismissible: false,
      });
    }
    return alerts;
  }

  private amount(value: number | null | undefined): number {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  private dateWhere(range: DateRange) {
    return {
      ...(range.from ? { gte: `${range.from.slice(0, 10)} 00:00:00` } : {}),
      ...(range.to ? { lte: `${range.to.slice(0, 10)} 23:59:59` } : {}),
    };
  }

  private async withFreshness<T>(
    storeId: string,
    operation: Parameters<StorePrismaClientFactory['withClient']>[1],
  ) {
    const result = await this.stores.withClient(storeId, operation);
    return {
      storeId,
      snapshotId: result.snapshot.id,
      schemaVersion: result.snapshot.schemaVersion,
      snapshotCreatedAt: result.snapshot.snapshotCreatedAt,
      syncedAt: result.snapshot.syncedAt,
      data: result.data as T,
    };
  }
}
