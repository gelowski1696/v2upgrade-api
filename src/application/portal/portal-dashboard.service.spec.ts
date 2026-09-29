import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorePrismaClientFactory } from '../../infrastructure/store-database/store-prisma-client.factory.js';
import { PortalDashboardService } from './portal-dashboard.service.js';

describe('PortalDashboardService report parity', () => {
  const storeId = 'store-parity';
  const snapshotId = 'snapshot-parity';
  const root = mkdtempSync(join(tmpdir(), 'posv2-owner-report-'));
  const backupRoot = join(root, 'backups');
  const snapshotDirectory = join(root, 'stores', storeId, 'snapshots');
  const snapshotPath = join(snapshotDirectory, `${snapshotId}.sqlite`);
  let factory: StorePrismaClientFactory;
  let service: PortalDashboardService;
  let controlDatabase: PrismaService;
  const preferenceFindUnique = jest.fn();
  const preferenceUpsert = jest.fn();
  const preferenceDeleteMany = jest.fn();
  const savedViewFindMany = jest.fn();
  const savedViewUpsert = jest.fn();
  const savedViewDeleteMany = jest.fn();
  const auditCreate = jest.fn().mockResolvedValue({});
  const auditFindMany = jest.fn().mockResolvedValue([]);
  const auditCount = jest.fn().mockResolvedValue(0);
  const deviceFindFirst = jest.fn().mockResolvedValue(null);

  const user: AuthenticatedPortalUser = {
    id: 'portal-user',
    sessionId: 'portal-session',
    clientId: 'client-one',
    username: 'owner',
    displayName: 'Owner',
    role: 'OWNER',
    storeIds: [storeId],
  };

  beforeAll(() => {
    mkdirSync(snapshotDirectory, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });
    createCashFlowFixture(snapshotPath);
    const snapshot = {
      id: snapshotId,
      storeId,
      deviceId: 'device-one',
      schemaVersion: 27,
      applicationVersion: '0.1.1',
      fileName: `${snapshotId}.sqlite`,
      fileSize: BigInt(1),
      sha256: 'fixture',
      status: 'ACTIVE',
      snapshotCreatedAt: new Date('2026-09-30T12:00:00.000Z'),
      uploadedAt: new Date('2026-09-30T12:01:00.000Z'),
      activatedAt: new Date('2026-09-30T12:02:00.000Z'),
      rejectionCode: null,
      rejectionMessage: null,
      createdAt: new Date('2026-09-30T12:00:00.000Z'),
    };
    controlDatabase = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ activeSnapshot: snapshot }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ code: 'MAIN', name: 'Main Store' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: storeId,
            code: 'MAIN',
            name: 'Main Store',
            activeSnapshot: {
              schemaVersion: 27,
              snapshotCreatedAt: new Date('2026-09-30T12:00:00.000Z'),
              activatedAt: new Date('2026-09-30T12:02:00.000Z'),
            },
          },
        ]),
      },
      portalAlertDismissal: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      portalSalesTarget: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      portalDashboardPreference: {
        findUnique: preferenceFindUnique.mockResolvedValue(null),
        upsert: preferenceUpsert.mockResolvedValue({}),
        deleteMany: preferenceDeleteMany.mockResolvedValue({ count: 1 }),
      },
      portalSavedView: {
        findMany: savedViewFindMany.mockResolvedValue([]),
        upsert: savedViewUpsert,
        deleteMany: savedViewDeleteMany.mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: auditCreate,
        findMany: auditFindMany,
        count: auditCount,
      },
      device: {
        findFirst: deviceFindFirst,
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'STORE_SNAPSHOT_ROOT') return root;
        if (key === 'PLATFORM_BACKUP_ROOT') return backupRoot;
        return fallback;
      }),
    } as unknown as ConfigService;
    factory = new StorePrismaClientFactory(controlDatabase, config);
    service = new PortalDashboardService(controlDatabase, factory, config);
  });

  afterAll(async () => {
    await factory.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
  });

  it('stores account-scoped dashboard preferences and saved views', async () => {
    preferenceFindUnique.mockResolvedValueOnce({
      overviewMetrics: ['CUSTOMER_BALANCE', 'GROSS_SALES'],
    });
    savedViewFindMany.mockResolvedValueOnce([
      {
        id: 'view-one',
        name: 'Weekly sales',
        report: 'sales',
        storeId,
        datePreset: 'LAST_7_DAYS',
        dateFrom: null,
        dateTo: null,
        filters: { status: 'COMPLETED' },
        updatedAt: new Date('2026-09-28T00:00:00.000Z'),
        store: { name: 'Main Store' },
      },
    ]);
    const preferences = await service.preferences(user);
    expect(preferences).toMatchObject({
      overviewMetrics: ['CUSTOMER_BALANCE', 'GROSS_SALES'],
      savedViews: [
        {
          id: 'view-one',
          storeId,
          storeName: 'Main Store',
          report: 'sales',
          datePreset: 'LAST_7_DAYS',
          filters: { status: 'COMPLETED' },
        },
      ],
    });

    await service.updateOverviewPreferences(user, [
      'INVENTORY_ALERTS',
      'GROSS_SALES',
    ]);
    expect(preferenceUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { portalUserId: user.id },
        update: { overviewMetrics: ['INVENTORY_ALERTS', 'GROSS_SALES'] },
      }),
    );

    savedViewUpsert.mockResolvedValueOnce({
      id: 'view-saved',
      name: 'Completed sales',
      report: 'sales',
      storeId,
      datePreset: 'LAST_30_DAYS',
      dateFrom: null,
      dateTo: null,
      filters: { search: 'Customer', status: 'COMPLETED' },
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
      store: { name: 'Main Store' },
    });
    const saved = await service.saveView(user, {
      name: ' Completed sales ',
      report: 'sales',
      storeId,
      datePreset: 'LAST_30_DAYS',
      filters: {
        search: 'Customer',
        status: 'COMPLETED',
        ignored: 'not persisted',
      },
    });
    expect(saved).toMatchObject({ id: 'view-saved', name: 'Completed sales' });
    expect(savedViewUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          portalUserId_name: {
            portalUserId: user.id,
            name: 'Completed sales',
          },
        },
        create: expect.objectContaining({
          filters: { search: 'Customer', status: 'COMPLETED' },
        }),
      }),
    );

    await expect(
      service.saveView(
        { ...user, storeIds: [] },
        {
          name: 'Unauthorized',
          report: 'sales',
          storeId,
          datePreset: 'LAST_7_DAYS',
          filters: {},
        },
      ),
    ).rejects.toThrow('You do not have access to this store.');

    await service.deleteSavedView(user, 'view-saved');
    expect(savedViewDeleteMany).toHaveBeenCalledWith({
      where: { id: 'view-saved', portalUserId: user.id },
    });
    const reset = await service.resetPreferences(user);
    expect(reset).toEqual({
      overviewMetrics: [
        'GROSS_SALES',
        'RECORDED_GROSS_PROFIT',
        'CUSTOMER_BALANCE',
        'INVENTORY_ALERTS',
      ],
      savedViews: [],
    });
  });

  it('returns an owner-safe activity ledger without raw audit metadata', async () => {
    auditFindMany.mockResolvedValueOnce([
      {
        id: 'activity-login',
        action: 'portal.login_succeeded',
        metadata: {
          portalUserId: user.id,
          deviceName: 'Google Chrome on Windows',
          ipAddress: '10.0.0.8',
          token: 'must-not-be-returned',
        },
        createdAt: new Date('2026-09-28T09:00:00.000Z'),
      },
      {
        id: 'activity-sync',
        action: 'sync.snapshot_activated',
        metadata: {
          storeId,
          schemaVersion: 27,
          sha256: 'must-not-be-returned',
        },
        createdAt: new Date('2026-09-28T08:00:00.000Z'),
      },
      {
        id: 'activity-backup',
        action: 'backup.platform_failed',
        metadata: { error: 'sensitive server path' },
        createdAt: new Date('2026-09-28T07:00:00.000Z'),
      },
    ]);
    auditCount.mockResolvedValueOnce(3);

    const activity = await service.activityLog(user, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 25,
    });

    expect(activity).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 25,
      items: [
        {
          id: 'activity-login',
          action: 'SECURITY',
          title: 'Signed in',
          actor: 'You',
          storeId: null,
        },
        {
          id: 'activity-sync',
          action: 'STORE_SYNC',
          title: 'Store data synchronized',
          storeId,
          storeName: 'Main Store',
        },
        {
          id: 'activity-backup',
          action: 'BACKUP',
          status: 'WARNING',
          title: 'Platform backup failed',
        },
      ],
      filterOptions: {
        stores: [expect.objectContaining({ id: storeId, name: 'Main Store' })],
      },
    });
    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain('10.0.0.8');
    expect(serialized).not.toContain('must-not-be-returned');
    expect(serialized).not.toContain('sensitive server path');

    await expect(
      service.activityLog(
        { ...user, storeIds: [] },
        {
          from: '2026-09-01',
          to: '2026-09-30',
          storeId,
          page: 1,
          pageSize: 25,
        },
      ),
    ).rejects.toThrow('You do not have access to this store.');
  });

  it('matches the desktop owner cash-flow definition', async () => {
    const response = await service.cashFlow(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(response).toMatchObject({
      storeId,
      snapshotId,
      schemaVersion: 27,
      data: {
        openingBalance: 85,
        salesReceipts: 450,
        creditCollections: 50,
        capitalCashIn: 100,
        pettyCashOut: 25,
        salaryPaid: 40,
        restockPayments: 180,
        cashReceived: 600,
        cashPaid: 245,
        netCashFlow: 355,
        closingBalance: 440,
      },
    });
  });

  it('identifies missing-cost periods and classifies legacy sales from line-cost evidence', async () => {
    const response = await service.dataQuality(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      compatibility: {
        status: 'PARTIAL',
        databaseSchemaVersion: 0,
        migrationVersion: null,
        issues: ['The snapshot does not contain migration history.'],
      },
      summary: {
        totalSales: 2,
        salesWithRecordedCost: 1,
        missingCostSales: 1,
        legacyMissingCostSales: 1,
        unexpectedMissingCostSales: 0,
        costCoveragePercent: 50,
      },
      periods: [
        {
          period: '2026-09',
          missingCostSales: 1,
          legacyMissingCostSales: 1,
          unexpectedMissingCostSales: 0,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      items: [
        expect.objectContaining({
          id: 2,
          reference: 'SALE-2',
          classification: 'LEGACY',
          recordedLineCost: 0,
        }),
      ],
    });
    expect(() =>
      service.dataQuality({ ...user, storeIds: [] }, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
  });

  it('classifies a missing sale header cost as unexpected when line cost exists', async () => {
    const database = new BetterSqlite3(snapshotPath);
    database
      .prepare('UPDATE salescart SET totalcost = 150 WHERE scid = 1')
      .run();
    database.close();
    try {
      const response = await service.dataQuality(user, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      });

      expect(response.data).toMatchObject({
        summary: {
          legacyMissingCostSales: 0,
          unexpectedMissingCostSales: 1,
        },
        items: [
          expect.objectContaining({
            reference: 'SALE-2',
            classification: 'UNEXPECTED',
            recordedLineCost: 150,
          }),
        ],
      });
    } finally {
      const restore = new BetterSqlite3(snapshotPath);
      restore
        .prepare('UPDATE salescart SET totalcost = 0 WHERE scid = 1')
        .run();
      restore.close();
    }
  });

  it('returns paginated cash-flow source transactions that reconcile to the summary', async () => {
    const response = await service.cashFlowTransactions(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      source: 'RESTOCK_PAYMENTS',
      page: 1,
      pageSize: 25,
    });

    expect(response).toMatchObject({
      storeId,
      data: {
        source: 'RESTOCK_PAYMENTS',
        label: 'Restock payments',
        direction: 'OUT',
        total: 2,
        page: 1,
        pageSize: 25,
        sourceTotal: 180,
        summaryTotal: 180,
        reconciliationDifference: 0,
      },
    });
    expect(response.data.items).toEqual([
      expect.objectContaining({
        id: 3,
        reference: 'TR-1',
        description: 'Supplier A',
        amount: -20,
      }),
      expect.objectContaining({
        id: 2,
        reference: 'TR-1',
        description: 'Supplier A',
        amount: 200,
      }),
    ]);
  });

  it('marks profit unavailable when historical sales have no recorded cost', async () => {
    const response = await service.overview(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(response).toMatchObject({
      storeId,
      data: {
        transactionCount: 2,
        salesWithRecordedCost: 1,
        salesMissingCostCount: 1,
        costCoveragePercent: 50,
        profitDataComplete: false,
        grossSales: 650,
        costOfGoods: 100,
        grossProfit: 550,
      },
    });
  });

  it('tracks monthly sales and recorded-profit targets in portal metadata', async () => {
    jest
      .mocked(controlDatabase.portalSalesTarget.findUnique)
      .mockResolvedValueOnce({
        id: 'target-one',
        storeId,
        month: '2026-09',
        salesTarget: 1000,
        recordedGrossProfitTarget: 600,
        updatedByPortalUserId: user.id,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-20T00:00:00.000Z'),
      } as never);

    const response = await service.salesTargetPerformance(
      user,
      storeId,
      '2026-09',
    );
    expect(response.data).toMatchObject({
      month: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
      canEdit: true,
      target: {
        configured: true,
        sales: 1000,
        recordedGrossProfit: 600,
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      actual: {
        grossSales: 650,
        recordedGrossProfit: 550,
        transactionCount: 2,
        costCoveragePercent: 50,
        profitDataComplete: false,
        missingCostSales: 1,
      },
      progress: {
        salesPercent: 65,
        recordedGrossProfitPercent: 91.67,
      },
      pace: {
        totalDays: 30,
      },
    });

    jest
      .mocked(controlDatabase.portalSalesTarget.findUnique)
      .mockResolvedValueOnce({
        id: 'target-one',
        storeId,
        month: '2026-09',
        salesTarget: 1200,
        recordedGrossProfitTarget: 700,
        updatedByPortalUserId: user.id,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-28T00:00:00.000Z'),
      } as never);
    const updated = await service.updateSalesTarget(user, storeId, {
      month: '2026-09',
      salesTarget: 1200,
      recordedGrossProfitTarget: 700,
    });
    expect(controlDatabase.portalSalesTarget.upsert).toHaveBeenCalledWith({
      where: { storeId_month: { storeId, month: '2026-09' } },
      create: {
        storeId,
        month: '2026-09',
        salesTarget: 1200,
        recordedGrossProfitTarget: 700,
        updatedByPortalUserId: user.id,
      },
      update: {
        salesTarget: 1200,
        recordedGrossProfitTarget: 700,
        updatedByPortalUserId: user.id,
      },
    });
    expect(updated.data.target).toMatchObject({
      sales: 1200,
      recordedGrossProfit: 700,
    });

    await expect(
      service.updateSalesTarget({ ...user, role: 'VIEWER' }, storeId, {
        month: '2026-09',
        salesTarget: 1000,
        recordedGrossProfitTarget: 600,
      }),
    ).rejects.toThrow('Only an owner or manager can update sales targets.');
    await expect(
      service.salesTargetPerformance(user, storeId, 'invalid'),
    ).rejects.toThrow('A valid target month is required.');
  });

  it('groups sales trends and compares the same-length preceding period', async () => {
    const response = await service.salesTrends(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      group: 'day',
    });

    expect(response.data).toMatchObject({
      grouping: 'day',
      current: {
        from: '2026-09-01',
        to: '2026-09-30',
        grossSales: 650,
        transactionCount: 2,
        averageSaleValue: 325,
        costOfGoods: 100,
        grossProfit: 550,
        salesMissingCostCount: 1,
        costCoveragePercent: 50,
        profitDataComplete: false,
      },
      previous: {
        from: '2026-08-02',
        to: '2026-08-31',
        grossSales: 90,
        transactionCount: 1,
        averageSaleValue: 90,
        costOfGoods: 40,
        grossProfit: 50,
        costCoveragePercent: 100,
        profitDataComplete: true,
      },
    });
    const dailyPoints = response.data.points as Array<{ grossSales: number }>;
    expect(dailyPoints).toHaveLength(30);
    expect(
      dailyPoints.reduce((total, point) => total + point.grossSales, 0),
    ).toBe(650);
    expect(response.data.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '2026-09-10',
          grossSales: 450,
          transactionCount: 1,
        }),
        expect.objectContaining({
          key: '2026-09-18',
          grossSales: 200,
          transactionCount: 1,
        }),
      ]),
    );

    const weekly = await service.salesTrends(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      group: 'week',
    });
    const monthly = await service.salesTrends(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      group: 'month',
    });
    const weeklyPoints = weekly.data.points as Array<{ grossSales: number }>;
    expect(weekly.data.grouping).toBe('week');
    expect(
      weeklyPoints.reduce((total, point) => total + point.grossSales, 0),
    ).toBe(650);
    expect(monthly.data).toMatchObject({
      grouping: 'month',
      points: [{ key: '2026-09-01', grossSales: 650, transactionCount: 2 }],
    });
  });

  it('returns store-scoped sale items and legacy sale notes', async () => {
    const response = await service.saleDetails(user, storeId, 2);

    expect(response).toMatchObject({
      storeId,
      data: {
        sale: {
          id: 2,
          reference: 'SALE-2',
          customer: 'Test Customer',
          totalAmount: 450,
        },
        items: [
          {
            itemCode: 'LPG-11',
            description: '11 kg refill',
            quantity: 2,
            total: 450,
          },
        ],
        notes: 'Leave at the side entrance.',
        attachmentStatus: 'NOT_SYNCED',
      },
    });
  });

  it('reconciles receivables aging and returns customer balance history', async () => {
    const aging = await service.receivablesAging(user, storeId, {
      to: '2026-09-30',
    });

    expect(aging.data).toMatchObject({
      asOf: '2026-09-30',
      totalReceivables: 75,
      customerCount: 1,
      invoiceTotal: 75,
      reconciliationDifference: 0,
      buckets: {
        current: 0,
        oneToThirty: 75,
        thirtyOneToSixty: 0,
        sixtyOneToNinety: 0,
        overNinety: 0,
        unallocated: 0,
      },
      highestBalances: [{ id: 1, name: 'Customer One', balance: 75 }],
      agingBasis: 'SALE_DATE',
    });
    expect(aging.data.recentCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: 'SALE-2',
          customerId: 1,
          customer: 'Customer One',
          amount: 50,
        }),
      ]),
    );

    const history = await service.customerBalanceHistory(user, storeId, 1);
    expect(history.data).toMatchObject({
      customer: { id: 1, name: 'Customer One', balance: 75 },
      openInvoices: [{ reference: 'SALE-4', balance: 75 }],
    });
    expect(history.data.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reference: 'SALE-2', amount: 50 }),
      ]),
    );
  });

  it('rejects sale detail access outside the assigned store', () => {
    expect(() =>
      service.saleDetails({ ...user, storeIds: [] }, storeId, 2),
    ).toThrow('You do not have access to this store.');
    expect(() =>
      service.receivablesAging({ ...user, storeIds: [] }, storeId, {
        to: '2026-09-30',
      }),
    ).toThrow('You do not have access to this store.');
    expect(() =>
      service.customerBalanceHistory({ ...user, storeIds: [] }, storeId, 1),
    ).toThrow('You do not have access to this store.');
  });

  it('returns only enabled web report capabilities from the active snapshot', async () => {
    const response = await service.reportCapabilities(user, storeId);

    expect(response.data).toEqual({
      available: true,
      reports: [
        'customer-report',
        'discount-report',
        'financial-report',
        'purchase-report',
        'special-receipts',
        'inventory-summary',
      ],
    });
    await expect(
      service.reportCapabilities({ ...user, role: 'VIEWER' }, storeId),
    ).resolves.toMatchObject({
      data: {
        available: true,
        reports: [
          'customer-report',
          'discount-report',
          'purchase-report',
          'special-receipts',
          'inventory-summary',
        ],
      },
    });
    expect(() =>
      service.reportCapabilities({ ...user, storeIds: [] }, storeId),
    ).toThrow('You do not have access to this store.');
  });

  it('prefers subscription feature mods over legacy snapshot switches', async () => {
    deviceFindFirst.mockResolvedValueOnce({
      subscription: {
        entitlements: { summaryCsv: false, discountReport: true },
      },
    });

    const capabilities = await service.reportCapabilities(user, storeId);

    expect(capabilities.data.reports).not.toContain('inventory-summary');
    expect(capabilities.data.reports).toContain('discount-report');
  });

  it('returns enabled Summary CSV and Financial Report data with desktop parity', async () => {
    const summary = await service.inventorySummaryReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(summary.data.openingSnapshotDate).toBe('2026-08-31');
    expect(summary.data.actualSnapshotDate).toBe('2026-09-30');
    expect(summary.data.rows[0]).toMatchObject({
      itemCode: 'LPG-11',
      openingFilled: 4,
      openingEmpty: 1,
      deliveries: 5,
      actualFilled: 2,
      actualEmpty: 1,
    });

    const financial = await service.financialReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(financial.data.openingSnapshotDate).toBe('2026-08-31');
    expect(financial.data.actualSnapshotDate).toBe('2026-09-30');
    expect(financial.data.productRows[0]).toMatchObject({
      itemCode: 'LPG-11',
      openingQuantity: 4,
      deliveredQuantity: 5,
      closingQuantity: 2,
      computedCogsQuantity: 7,
      salesQuantity: 2,
      salesTotal: 450,
    });
    expect(() =>
      service.financialReport({ ...user, role: 'VIEWER' }, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    ).toThrow('Only an owner can view the financial report.');
  });

  it('matches the remaining enabled desktop Feature Mod reports', async () => {
    const range = { from: '2026-09-01', to: '2026-09-30' };
    const pagedRange = { ...range, page: 1, pageSize: 25 };
    const [discounts, purchases, specialReceipts, customers] =
      await Promise.all([
        service.discountReport(user, storeId, pagedRange),
        service.purchaseReport(user, storeId, pagedRange),
        service.specialReceiptReport(user, storeId, range),
        service.customerReport(user, storeId, range),
      ]);

    expect(discounts.data.totalAmount).toBe(65);
    expect(discounts.data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(discounts.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: 'SALE-2',
          regularDiscount: 10,
          specialDiscount: 5,
        }),
      ]),
    );
    expect(purchases.data.items).toEqual([
      expect.objectContaining({
        reference: 'TR-1',
        supplier: 'Supplier A',
        driver: 'Driver One',
        purchaseType: 'RESTOCK IN',
        totalQuantity: 5,
        totalAmount: 500,
      }),
    ]);
    expect(purchases.data.totalAmount).toBe(500);
    expect(purchases.data).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(specialReceipts.data).toMatchObject({
      totalAmount: 450,
      items: [{ salesId: 2, reference: 'SALE-2', customer: 'Test Customer' }],
    });
    expect(customers.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          salesId: 2,
          reference: 'SALE-2',
          address: 'Test address',
          groupName: 'Retail',
        }),
      ]),
    );
  });

  it('shows confirmed restock purchases even when no supplier payment exists', async () => {
    const purchases = await service.purchaseReport(user, storeId, {
      from: '2026-10-01',
      to: '2026-10-31',
      page: 1,
      pageSize: 25,
    });

    expect(purchases.data).toEqual({
      items: [
        {
          id: 3,
          purchaseDate: '2026-10-05 10:00:00',
          reference: 'TR-3',
          supplier: 'Supplier B',
          driver: '',
          purchaseType: 'W.RESTOCK IN',
          totalQuantity: 3,
          totalAmount: 360,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalAmount: 360,
    });
  });

  it('paginates purchase records while preserving the full-range total', async () => {
    const firstPage = await service.purchaseReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-10-31',
      page: 1,
      pageSize: 1,
    });
    const secondPage = await service.purchaseReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-10-31',
      page: 2,
      pageSize: 1,
    });

    expect(firstPage.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      totalAmount: 860,
      items: [{ id: 3, reference: 'TR-3' }],
    });
    expect(secondPage.data).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 1,
      totalAmount: 860,
      items: [{ id: 1, reference: 'TR-1' }],
    });
  });

  it('paginates discounts while preserving the full-range total', async () => {
    const firstPage = await service.discountReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 1,
    });
    const secondPage = await service.discountReport(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 2,
      pageSize: 1,
    });

    expect(firstPage.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      totalAmount: 65,
      items: [{ reference: 'SALE-4' }],
    });
    expect(secondPage.data).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 1,
      totalAmount: 65,
      items: [{ reference: 'SALE-2' }],
    });
  });

  it('hides and rejects a report when its desktop Feature Mod is disabled', async () => {
    const database = new BetterSqlite3(snapshotPath);
    database
      .prepare(
        "UPDATE owner_feature_mods SET enabled = 0 WHERE feature_key = 'summaryCsv'",
      )
      .run();
    database.close();
    try {
      const capabilities = await service.reportCapabilities(user, storeId);
      expect(capabilities.data.reports).not.toContain('inventory-summary');
      await expect(
        service.inventorySummaryReport(user, storeId, {
          from: '2026-09-01',
          to: '2026-09-30',
        }),
      ).rejects.toThrow('Summary CSV is not enabled for this store.');
    } finally {
      const restore = new BetterSqlite3(snapshotPath);
      restore
        .prepare(
          "UPDATE owner_feature_mods SET enabled = 1 WHERE feature_key = 'summaryCsv'",
        )
        .run();
      restore.close();
    }
  });

  it('exports every report from the full authorized snapshot', async () => {
    const reports = [
      ['sales', 'Reference'],
      ['inventory', 'Warehouse fill'],
      ['transfers', 'Payment status'],
      ['customer-balances', 'Balance'],
      ['cash-flow', 'Closing cash position'],
    ] as const;

    for (const [report, expectedText] of reports) {
      const response = await service.exportReport(user, storeId, report, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(response.storeId).toBe(storeId);
      expect(response.data.fileName).toBe(
        `main-store-${report}-2026-09-01-to-2026-09-30.csv`,
      );
      expect(response.data.content.startsWith('\uFEFF')).toBe(true);
      expect(response.data.content).toContain(expectedText);
      expect(response.data.rowCount).toBeGreaterThan(0);
      if (report === 'inventory') {
        expect(response.data.content).toContain('Refill price');
        expect(response.data.content).toContain('Non-refill price');
        expect(response.data.content).toContain('450,1200');
      }
    }
  });

  it('neutralizes spreadsheet formulas in exported text', async () => {
    const response = await service.exportReport(user, storeId, 'sales', {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(response.data.content).toContain("'=HYPERLINK");
    expect(response.data.content).not.toContain(',=HYPERLINK(');
  });

  it('rejects unknown and unauthorized exports', async () => {
    await expect(
      service.exportReport(user, storeId, 'unknown-report', {}),
    ).rejects.toThrow('This report cannot be exported.');
    await expect(
      service.exportReport({ ...user, storeIds: [] }, storeId, 'sales', {}),
    ).rejects.toThrow('You do not have access to this store.');
  });

  it('searches and filters each paginated report on the server', async () => {
    const sales = await service.sales(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      search: 'test customer',
      status: 'COMPLETED',
      payment: 'CASH',
      page: 1,
      pageSize: 25,
    });
    expect(sales.data).toMatchObject({
      total: 1,
      items: [{ reference: 'SALE-2' }],
      filterOptions: {
        statuses: ['CANCELLED', 'COMPLETED', 'UNPAID'],
        payments: ['CASH'],
      },
    });

    const productSales = await service.sales(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      itemCode: 'lpg-11',
      page: 1,
      pageSize: 25,
    });
    expect(productSales.data).toMatchObject({
      total: 1,
      items: [{ reference: 'SALE-2' }],
    });

    const missingProductSales = await service.sales(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      itemCode: 'MISSING',
      page: 1,
      pageSize: 25,
    });
    expect(missingProductSales.data).toMatchObject({ total: 0, items: [] });

    const inventory = await service.inventory(user, storeId, {
      search: 'LPG-22',
      page: 1,
      pageSize: 25,
    });
    expect(inventory.data).toMatchObject({
      total: 1,
      items: [{ code: 'LPG-22', refillPrice: 850, nonRefillPrice: 2400 }],
      summary: {
        trackedItems: 2,
        criticalItems: 1,
        healthyItems: 1,
        outOfStockItems: 0,
        recordedValue: 3200,
        valuationCoveragePercent: 100,
        valuationComplete: true,
      },
      filterOptions: {
        categories: ['LPG'],
        stockStatuses: ['OUT_OF_STOCK', 'CRITICAL', 'HEALTHY'],
      },
    });

    const criticalInventory = await service.inventory(user, storeId, {
      category: 'LPG',
      stockStatus: 'CRITICAL',
      page: 1,
      pageSize: 25,
    });
    expect(criticalInventory.data).toMatchObject({
      total: 1,
      items: [{ code: 'LPG-11', stockStatus: 'CRITICAL' }],
    });

    const transfers = await service.transfers(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      search: 'Supplier A',
      page: 1,
      pageSize: 25,
    });
    expect(transfers.data).toMatchObject({
      total: 1,
      items: [{ reference: 'TR-1' }],
    });

    const balances = await service.customerBalances(user, storeId, {
      search: '09170000000',
      page: 1,
      pageSize: 25,
    });
    expect(balances.data).toMatchObject({
      total: 1,
      items: [{ name: 'Customer One' }],
    });
  });

  it('loads read-only inventory movements from history and adjustments', async () => {
    const response = await service.inventoryHistory(user, storeId, 1, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      item: { id: 1, code: 'LPG-11', stockStatus: 'CRITICAL' },
      total: 2,
      page: 1,
      pageSize: 25,
      historyAvailable: true,
    });
    expect(response.data.items).toEqual([
      expect.objectContaining({
        reference: 'ADJ-1',
        quantity: 1,
        quantityBefore: 1,
        quantityAfter: 2,
      }),
      expect.objectContaining({
        reference: 'SALE-2',
        quantity: -2,
        origin: 'STORE',
      }),
    ]);

    expect(() =>
      service.inventoryHistory({ ...user, storeIds: [] }, storeId, 1, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
  });

  it('forecasts inventory demand and exports filtered reorder recommendations', async () => {
    const response = await service.inventoryForecast(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      forecastDays: 14,
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      total: 2,
      analysisDays: 30,
      forecastDays: 14,
      leadTimeDays: 7,
      summary: {
        availableStock: 19,
        projectedDemand: 1,
        suggestedReorder: 0,
        estimatedReorderCost: 0,
        attentionItems: 0,
        reorderNowItems: 0,
        noRecentSalesItems: 1,
      },
      filterOptions: {
        categories: ['LPG'],
      },
      items: [
        expect.objectContaining({
          code: 'LPG-11',
          salesQuantity: 2,
          averageDailySales: 0.07,
          daysRemaining: 90,
          suggestedReorder: 0,
          risk: 'HEALTHY',
        }),
        expect.objectContaining({
          code: 'LPG-22',
          salesQuantity: 0,
          daysRemaining: null,
          suggestedReorder: 0,
          risk: 'NO_RECENT_SALES',
        }),
      ],
    });

    const filtered = await service.inventoryForecast(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      forecastDays: 14,
      risk: 'HEALTHY',
      search: '11 kg',
      category: ' lpg ',
      page: 1,
      pageSize: 25,
    });
    expect(filtered.data).toMatchObject({
      total: 1,
      items: [{ code: 'LPG-11' }],
    });

    const exported = await service.exportReport(
      user,
      storeId,
      'inventory-forecast',
      {
        from: '2026-09-01',
        to: '2026-09-30',
        forecastDays: 14,
        risk: 'HEALTHY',
      },
    );
    expect(exported.data.fileName).toContain('inventory-forecast');
    expect(exported.data.rowCount).toBe(1);
    expect(exported.data.content).toContain('Suggested reorder');
    expect(exported.data.content).toContain('LPG-11');

    expect(() =>
      service.inventoryForecast({ ...user, storeIds: [] }, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
        forecastDays: 14,
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
  });

  it('loads read-only transfer details with item lines and supplier payments', async () => {
    const response = await service.transferDetails(user, storeId, 1);

    expect(response.data).toMatchObject({
      transfer: {
        id: 1,
        reference: 'TR-1',
        type: 'RESTOCK IN',
        purchaseAmount: 500,
        paidAmount: 220,
        outstandingAmount: 280,
      },
      lines: [
        {
          itemCode: 'LPG-11',
          itemName: '11 kg LPG',
          unit: 'FULL',
          quantity: 5,
          unitCost: 100,
          lineTotal: 500,
        },
      ],
      payments: [
        { id: 3, kind: 'REFUND', amount: 20 },
        { id: 2, kind: 'PAYMENT', amount: 200 },
        { id: 1, kind: 'PAYMENT', amount: 40 },
      ],
      lineItemsAvailable: true,
      paymentHistoryAvailable: true,
    });

    await expect(service.transferDetails(user, storeId, 999)).rejects.toThrow(
      'Transfer record was not found.',
    );
    expect(() =>
      service.transferDetails({ ...user, storeIds: [] }, storeId, 1),
    ).toThrow('You do not have access to this store.');
  });

  it('keeps restock receipts and supplier settlement separate', async () => {
    const response = await service.restockMonitoring(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      total: 1,
      summary: {
        confirmedRestocks: 1,
        receivedQuantity: 5,
        purchaseAmount: 500,
        supplierPayments: 200,
        supplierRefunds: 20,
        netSupplierPayments: 180,
        outstandingPayables: 280,
        cashFlowRestockPayments: 180,
        reconciliationDifference: 0,
      },
      items: [
        expect.objectContaining({
          reference: 'TR-1',
          receiptStatus: 'CONFIRMED',
          payments: 240,
          refunds: 20,
          netPaid: 220,
          outstanding: 280,
        }),
      ],
    });
  });

  it('summarizes product performance from non-cancelled sold-item lines', async () => {
    const response = await service.productPerformance(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(response.data).toMatchObject({
      summary: {
        quantity: 2,
        revenue: 450,
        recordedCost: 0,
        recordedGrossProfit: 450,
        missingCostLines: 1,
        costDataComplete: false,
      },
      topSelling: [
        expect.objectContaining({
          itemCode: 'LPG-11',
          quantity: 2,
          revenue: 450,
        }),
      ],
    });
    expect(response.data.slowMoving[0]).toMatchObject({
      itemCode: 'LPG-22',
      quantity: 0,
    });
  });

  it('ranks product and category profitability with prior-period comparison', async () => {
    const response = await service.profitability(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      profitabilitySort: 'PROFIT',
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      currentRange: { from: '2026-09-01', to: '2026-09-30' },
      previousRange: { from: '2026-08-02', to: '2026-08-31' },
      rankBy: 'PROFIT',
      total: 1,
      summary: {
        current: {
          revenue: 450,
          recordedCost: 0,
          recordedGrossProfit: 450,
          recordedMarginPercent: 100,
          missingCostLines: 1,
          costCoveragePercent: 0,
          costDataComplete: false,
        },
        previous: {
          revenue: 0,
          recordedGrossProfit: 0,
        },
        recordedGrossProfitChange: 450,
        recordedGrossProfitChangePercent: null,
      },
      categories: [
        expect.objectContaining({
          category: 'LPG',
          revenue: 450,
          recordedGrossProfit: 450,
          recordedMarginPercent: 100,
        }),
      ],
      filterOptions: {
        categories: ['LPG'],
      },
      items: [
        expect.objectContaining({
          itemCode: 'LPG-11',
          category: 'LPG',
          revenue: 450,
          recordedGrossProfit: 450,
          recordedMarginPercent: 100,
          costCoveragePercent: 0,
          previousRecordedGrossProfit: 0,
        }),
      ],
    });

    const filtered = await service.profitability(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      search: '11 kg',
      category: ' lpg ',
      profitabilitySort: 'MARGIN',
      page: 1,
      pageSize: 25,
    });
    expect(filtered.data).toMatchObject({
      rankBy: 'MARGIN',
      total: 1,
      items: [{ itemCode: 'LPG-11' }],
    });

    const exported = await service.exportReport(
      user,
      storeId,
      'profitability',
      {
        from: '2026-09-01',
        to: '2026-09-30',
        category: 'LPG',
        profitabilitySort: 'PROFIT',
      },
    );
    expect(exported.data.fileName).toContain('profitability');
    expect(exported.data.rowCount).toBe(1);
    expect(exported.data.content).toContain('Recorded gross profit');
    expect(exported.data.content).toContain('LPG-11');

    expect(() =>
      service.profitability({ ...user, storeIds: [] }, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
  });

  it('ranks customer purchases and returns store-scoped purchase history', async () => {
    const response = await service.customerInsights(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      customerSort: 'SPEND',
      page: 1,
      pageSize: 25,
    });

    expect(response.data).toMatchObject({
      range: { from: '2026-09-01', to: '2026-09-30' },
      rankBy: 'SPEND',
      summary: {
        customerCount: 1,
        repeatCustomerCount: 1,
        visitCount: 2,
        recordedSpend: 650,
        averagePurchase: 325,
        outstandingBalance: 75,
        lastPurchaseDate: '2026-09-18 10:00:00',
      },
      total: 1,
      items: [
        expect.objectContaining({
          id: 1,
          name: 'Customer One',
          contact: '09170000000',
          visitCount: 2,
          recordedSpend: 650,
          averagePurchase: 325,
          balance: 75,
          spendSharePercent: 100,
          daysSinceLastPurchase: 12,
        }),
      ],
    });

    const filtered = await service.customerInsights(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
      search: '0917',
      customerSort: 'VISITS',
      page: 1,
      pageSize: 25,
    });
    expect(filtered.data).toMatchObject({ rankBy: 'VISITS', total: 1 });

    const history = await service.customerPurchaseHistory(user, storeId, 1, {
      from: '2026-09-01',
      to: '2026-09-30',
      page: 1,
      pageSize: 25,
    });
    expect(history.data).toMatchObject({
      customer: {
        id: 1,
        name: 'Customer One',
        balance: 75,
      },
      summary: {
        visitCount: 2,
        recordedSpend: 650,
        averagePurchase: 325,
        firstPurchaseDate: '2026-09-10 10:00:00',
        lastPurchaseDate: '2026-09-18 10:00:00',
      },
      total: 2,
      items: [
        expect.objectContaining({
          id: 4,
          reference: 'SALE-4',
          totalAmount: 200,
        }),
        expect.objectContaining({
          id: 2,
          reference: 'SALE-2',
          totalAmount: 450,
        }),
      ],
    });

    const exported = await service.exportReport(
      user,
      storeId,
      'customer-insights',
      {
        from: '2026-09-01',
        to: '2026-09-30',
        search: 'Customer One',
        customerSort: 'SPEND',
      },
    );
    expect(exported.data.fileName).toContain('customer-insights');
    expect(exported.data.rowCount).toBe(1);
    expect(exported.data.content).toContain('Recorded spend');
    expect(exported.data.content).toContain('Customer One');

    expect(() =>
      service.customerInsights({ ...user, storeIds: [] }, storeId, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
    expect(() =>
      service.customerPurchaseHistory({ ...user, storeIds: [] }, storeId, 1, {
        from: '2026-09-01',
        to: '2026-09-30',
        page: 1,
        pageSize: 25,
      }),
    ).toThrow('You do not have access to this store.');
  });

  it('separates sale receipts from later credit collections', async () => {
    const response = await service.paymentAnalysis(user, storeId, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(response.data.summary).toMatchObject({
      paidSales: 450,
      paidSaleCount: 1,
      unpaidSales: 200,
      unpaidSaleCount: 1,
      outstandingBalance: 75,
      saleReceipts: 450,
      creditCollections: 50,
      totalReceived: 500,
      cashFlowReceipts: 500,
      reconciliationDifference: 0,
    });
    expect(response.data.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'CASH',
          saleReceipts: 450,
          creditCollections: 50,
          totalReceived: 500,
        }),
      ]),
    );
  });

  it('combines only authorized compatible stores and raises owner alerts', async () => {
    writeFileSync(
      join(backupRoot, 'health.json'),
      JSON.stringify({
        platformBackup: {
          status: 'FAIL',
          checkedAt: '2026-09-30T02:00:00.000Z',
          error: 'Sensitive backup server path',
        },
        restoreDrill: {
          status: 'FAIL',
          checkedAt: '2026-09-30T03:00:00.000Z',
          error: 'Sensitive restore database name',
        },
      }),
    );
    jest.mocked(controlDatabase.store.findMany).mockResolvedValueOnce([
      {
        id: storeId,
        code: 'MAIN',
        name: 'Main Store',
        activeSnapshot: {
          schemaVersion: 27,
          snapshotCreatedAt: new Date('2026-09-30T12:00:00.000Z'),
          activatedAt: new Date('2026-09-30T12:02:00.000Z'),
        },
      },
      {
        id: 'store-legacy',
        code: 'OLD',
        name: 'Legacy Store',
        activeSnapshot: {
          schemaVersion: 26,
          snapshotCreatedAt: new Date('2026-09-30T11:00:00.000Z'),
          activatedAt: new Date('2026-09-30T11:02:00.000Z'),
        },
      },
    ] as never);
    const response = await service.businessOverview(
      { ...user, storeIds: [storeId, 'store-legacy'] },
      {
        from: '2026-09-01',
        to: '2026-09-30',
      },
    );

    expect(response).toMatchObject({
      storeId: 'ALL',
      schemaVersion: 27,
      data: {
        authorizedStoreCount: 2,
        includedStoreCount: 1,
        excludedStoreCount: 1,
        summary: {
          grossSales: 650,
          transactionCount: 2,
          recordedGrossProfit: 550,
          customerBalance: 75,
          netCashFlow: 355,
          criticalItems: 1,
        },
        stores: [expect.objectContaining({ id: storeId, name: 'Main Store' })],
      },
    });
    expect(response.data.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'INVENTORY',
          storeId,
          dismissible: true,
        }),
        expect.objectContaining({
          type: 'DISCOUNT',
          storeId,
          saleId: 4,
          reference: 'SALE-4',
          discountPercent: 20,
          amount: 50,
          dismissible: true,
        }),
        expect.objectContaining({
          type: 'BACKUP',
          storeId: 'ALL',
          title: 'Platform backup failed',
          dismissible: false,
        }),
        expect.objectContaining({
          type: 'BACKUP',
          storeId: 'ALL',
          title: 'Restore drill failed',
        }),
        expect.objectContaining({
          type: 'SYNC',
          storeId: 'store-legacy',
          title: 'Store excluded from combined totals',
        }),
      ]),
    );
    expect(JSON.stringify(response.data.alerts)).not.toContain('Sensitive');
  });

  it('persists informational dismissals per portal user and keeps high alerts mandatory', async () => {
    writeFileSync(
      join(backupRoot, 'health.json'),
      JSON.stringify({
        platformBackup: {
          status: 'FAIL',
          checkedAt: '2026-09-30T02:00:00.000Z',
        },
      }),
    );
    const range = { from: '2026-09-01', to: '2026-09-30' };
    const informationalAlertId = `discount-${storeId}-4`;

    await expect(
      service.dismissAlert(user, informationalAlertId, range),
    ).resolves.toEqual({
      alertId: informationalAlertId,
      dismissed: true,
    });
    expect(controlDatabase.portalAlertDismissal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          portalUserId_alertId: {
            portalUserId: user.id,
            alertId: informationalAlertId,
          },
        },
      }),
    );

    await expect(
      service.dismissAlert(
        user,
        'backup-platformBackup-2026-09-30T02:00:00.000Z',
        range,
      ),
    ).rejects.toThrow('High-severity alerts cannot be dismissed');

    jest
      .mocked(controlDatabase.portalAlertDismissal.findMany)
      .mockResolvedValueOnce([{ alertId: informationalAlertId }] as never);
    const filtered = await service.businessOverview(user, range);
    expect(
      filtered.data.alerts.some((alert) => alert.id === informationalAlertId),
    ).toBe(false);
    expect(
      filtered.data.alerts.some(
        (alert) =>
          alert.id === 'backup-platformBackup-2026-09-30T02:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('applies the same filters to CSV exports', async () => {
    const response = await service.exportReport(user, storeId, 'sales', {
      from: '2026-09-01',
      to: '2026-09-30',
      search: 'SALE-2',
      status: 'COMPLETED',
      payment: 'CASH',
      itemCode: 'LPG-11',
    });

    expect(response.data.rowCount).toBe(1);
    expect(response.data.content).toContain('SALE-2');
    expect(response.data.content).not.toContain('SALE-4');
  });
});

function createCashFlowFixture(path: string): void {
  const database = new BetterSqlite3(path);
  database.exec(`
    CREATE TABLE salestbl (
      salesid INTEGER PRIMARY KEY,
      salesrefnum TEXT,
      salescust TEXT,
      salescustadd TEXT,
      salespaym TEXT,
      salescashier TEXT,
      salestotalitem INTEGER,
      salessub REAL,
      salescreditpaid REAL,
      salescreditbal TEXT,
      salesdisc REAL,
      salescat TEXT,
      salescustid INTEGER,
      salespaytype TEXT,
      salestotalcost REAL,
      specialdisc REAL,
      salesdate TEXT,
      salestender REAL,
      saleschange REAL,
      salestatus TEXT,
      salestotalamount REAL,
      salesremarks TEXT,
      spreceipt TEXT,
      tenderbalance REAL
    );
    CREATE TABLE salescart (
      scid INTEGER PRIMARY KEY,
      screfnum TEXT,
      scitemcode TEXT,
      scitemdesc TEXT,
      scunit TEXT,
      scprice REAL,
      sctotal REAL,
      scqty INTEGER,
      scdiscount REAL,
      scstats TEXT,
      sccost REAL,
      totalcost REAL,
      scdate TEXT
    );
    CREATE TABLE creditpaymenttbl (
      cpid INTEGER PRIMARY KEY,
      cprefnum TEXT,
      cpcustname TEXT,
      cpcustid INTEGER,
      cppaydate TEXT,
      cppay REAL,
      cppaymethod TEXT,
      cpbalance REAL,
      cprembal REAL
    );
    CREATE TABLE pettylogstbl (
      pettylogid INTEGER PRIMARY KEY,
      pettylogdate TEXT,
      pettylogtype TEXT,
      pettylogamount REAL,
      pettyref TEXT
    );
    CREATE TABLE salhistory (
      salhid INTEGER PRIMARY KEY,
      saldate TEXT,
      salrefdate TEXT,
      salpaid REAL
    );
    CREATE TABLE pouttbl (
      poutid INTEGER PRIMARY KEY,
      poutrefnum TEXT,
      pouttype TEXT,
      pulldate TEXT,
      pullsupplier TEXT,
      pouttransto TEXT,
      pouttotalqty INTEGER,
      pouttotalamount REAL,
      poutencoder TEXT,
      pulloutremarks TEXT,
      restockprice REAL,
      notes TEXT,
      payment_status TEXT,
      invoice_reference TEXT,
      confirmed_at TEXT,
      paid_at TEXT,
      payment_method TEXT,
      payment_reference TEXT,
      poutpid INTEGER
    );
    CREATE TABLE pulloutcart (
      pid INTEGER PRIMARY KEY,
      poutref TEXT,
      pouttype TEXT,
      poutitemcode TEXT,
      poutitemname TEXT,
      poutqty INTEGER,
      poutcost REAL,
      poutotal REAL,
      poutdate TEXT
    );
    CREATE TABLE inventorytbl (
      itemid INTEGER PRIMARY KEY,
      itemcode TEXT,
      itembrand TEXT,
      itemname TEXT,
      itemsize TEXT,
      itemqty INTEGER,
      itemcost REAL,
      itemsellprice REAL,
      itemcategory TEXT,
      fillqty INTEGER,
      emptyqty INTEGER,
      whfill INTEGER,
      whempty INTEGER,
      lendqty INTEGER,
      alertnum INTEGER
    );
    CREATE TABLE pricelisttbl (
      itemid INTEGER,
      Refill REAL,
      Non_Refill REAL
    );
    CREATE TABLE itemhistorytbl (
      itemhid INTEGER PRIMARY KEY,
      itemhdate TEXT,
      itemhitemc TEXT,
      itemhrefnum TEXT,
      itemhorigin TEXT,
      itemhqty INTEGER,
      itemhremarks TEXT,
      itemhfromqty INTEGER,
      itemhtoqty INTEGER
    );
    CREATE TABLE inventory_adjustments (
      adjustment_id INTEGER PRIMARY KEY,
      itemid INTEGER,
      unit TEXT,
      quantity_delta INTEGER,
      quantity_before INTEGER,
      quantity_after INTEGER,
      reason TEXT,
      remarks TEXT,
      adjusted_by TEXT,
      adjusted_at TEXT
    );
    CREATE TABLE custinfo (
      custid INTEGER PRIMARY KEY,
      custname TEXT,
      custcontnum TEXT,
      custbalance REAL,
      custstatus TEXT
    );
    CREATE TABLE supplier_restock_payments (
      payment_id INTEGER PRIMARY KEY,
      transfer_id INTEGER,
      amount REAL,
      paid_at TEXT,
      payment_kind TEXT,
      payment_method TEXT,
      payment_reference TEXT,
      notes TEXT,
      recorded_by TEXT
    );
    CREATE TABLE owner_feature_mods (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      config_version INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE categorytbl (
      catid INTEGER PRIMARY KEY,
      category TEXT,
      csv TEXT
    );
    CREATE TABLE invetorycounttbl (
      itemcode TEXT,
      itemdesc TEXT,
      fillqty INTEGER,
      emptyqty INTEGER,
      date TEXT,
      location TEXT,
      whfillqty INTEGER,
      whemptyqty INTEGER,
      category TEXT
    );
    CREATE TABLE disposehistory (
      disitemcode TEXT,
      disqty INTEGER,
      disremarks TEXT,
      disdate TEXT
    );
    CREATE TABLE inventory_cost_receipts (
      receipt_id INTEGER PRIMARY KEY,
      itemid INTEGER,
      itemcode TEXT,
      location TEXT,
      unit TEXT,
      quantity INTEGER,
      line_total REAL,
      new_average_cost REAL,
      confirmed_at TEXT
    );
    CREATE TABLE personeltbl (
      pid INTEGER PRIMARY KEY,
      pname TEXT
    );
    CREATE TABLE customer_groups (
      group_id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE customer_group_members (
      customer_id INTEGER PRIMARY KEY,
      group_id INTEGER
    );

    INSERT INTO owner_feature_mods VALUES
      ('customerImport', 1, 1, '2026-09-30T12:00:00Z'),
      ('customerReport', 1, 1, '2026-09-30T12:00:00Z'),
      ('discountReport', 1, 1, '2026-09-30T12:00:00Z'),
      ('financialReport', 1, 1, '2026-09-30T12:00:00Z'),
      ('loyaltyPoints', 0, 1, '2026-09-30T12:00:00Z'),
      ('purchases', 1, 1, '2026-09-30T12:00:00Z'),
      ('specialReceipts', 1, 1, '2026-09-30T12:00:00Z'),
      ('summaryCsv', 1, 1, '2026-09-30T12:00:00Z');

    INSERT INTO salestbl (
      salesid, salesdate, salestender, saleschange, salestatus,
      salestotalamount, salestotalcost, salesdisc, specialdisc
    ) VALUES
      (1, '2026-08-31 10:00:00', 100, 10, 'COMPLETED', 90, 40, 0, 0),
      (2, '2026-09-10 10:00:00', 500, 50, 'COMPLETED', 450, 0, 0, 0),
      (3, '2026-09-11 10:00:00', 1000, 0, 'CANCELLED', 1000, 400, 0, 0),
      (4, '2026-09-18 10:00:00', 0, 0, 'COMPLETED', 200, 100, 0, 0);
    UPDATE salestbl
       SET salesrefnum = 'SALE-2', salescust = 'Test Customer', salespaym = 'CASH',
           salescashier = 'Cashier One', salestotalitem = 2, salessub = 450,
           salescreditpaid = 0, salescreditbal = '0', salescat = 'DELIVERY',
           salescustid = 1, salespaytype = 'FULL PAYMENT',
           salesremarks = 'Leave at the side entrance.', salescustadd = 'Test address',
           salesdisc = 10, specialdisc = 5, spreceipt = 'Y'
     WHERE salesid = 2;
    UPDATE salestbl
       SET salesrefnum = 'SALE-4',
           salescust = '=HYPERLINK("https://invalid.test")', salescustid = 1,
           salescashier = 'Cashier Two', salestatus = 'UNPAID', tenderbalance = 75,
           salesdisc = 40, specialdisc = 10
     WHERE salesid = 4;
    INSERT INTO salescart VALUES
      (1, 'SALE-2', 'LPG-11', '11 kg refill', 'PC', 225, 450, 2, 0, 'SOLD', 0, 0,
       '2026-09-10 10:00:00');
    INSERT INTO creditpaymenttbl VALUES
      (1, 'SALE-1', 'Customer One', 1, '2026-08-31 11:00:00', 20, 'CASH', 95, 75),
      (2, 'SALE-2', 'Customer One', 1, '2026-09-12 11:00:00', 50, 'CASH', 125, 75);
    INSERT INTO pettylogstbl VALUES
      (1, '2026-08-31 12:00:00', 'CASH IN', 30, 'CONFIRMED'),
      (2, '2026-08-31 12:30:00', 'CASH OUT', 5, 'CONFIRMED'),
      (3, '2026-09-13 12:00:00', 'CASH IN', 100, 'CONFIRMED'),
      (4, '2026-09-13 12:30:00', 'CASH OUT', 25, 'CONFIRMED'),
      (5, '2026-09-13 13:00:00', 'CASH OUT', 999, 'CANCELLED');
    INSERT INTO salhistory VALUES
      (1, '2026-08-31 14:00:00', NULL, 10),
      (2, '2026-09-14 14:00:00', NULL, 40);
    INSERT INTO pouttbl (
      poutid, poutrefnum, pouttype, pulldate, pullsupplier, pouttransto,
      pouttotalqty, pouttotalamount, poutencoder, pulloutremarks, restockprice,
      notes, payment_status
    ) VALUES
      (1, 'TR-1', 'RESTOCK IN', '2026-09-15 10:00:00', 'Supplier A', 'Store',
       5, 500, 'Owner', 'CONFIRMED', 500, 'September stock', 'PAID'),
      (2, 'TR-2', 'TRANSFER OUT', '2026-09-16 10:00:00', '', 'Warehouse',
       2, 0, 'Owner', 'CONFIRMED', 0, '', 'NOT APPLICABLE'),
      (3, 'TR-3', 'W.RESTOCK IN', '2026-10-05 10:00:00', 'Supplier B', 'Warehouse',
       3, 360, 'Owner', 'CONFIRMED', 360, 'October stock', 'UNPAID');
    INSERT INTO personeltbl VALUES (1, 'Driver One');
    UPDATE pouttbl SET poutpid = 1 WHERE poutid = 1;
    INSERT INTO pulloutcart VALUES
      (1, 'TR-1', 'RESTOCK INFILL', 'LPG-11', '11 kg LPG', 5, 100, 500, '2026-09-15 10:00:00'),
      (2, 'TR-2', 'TRANSFER OUTFILL', 'LPG-22', '22 kg LPG', 2, 0, 0, '2026-09-16 10:00:00');
    INSERT INTO inventorytbl (
      itemid, itemcode, itembrand, itemname, itemsize, itemqty, itemcost,
      itemsellprice, itemcategory, fillqty, emptyqty, whfill, whempty, lendqty,
      alertnum
    ) VALUES
      (1, 'LPG-11', 'Brand A', '11 kg LPG', '11 kg', 2, 100, 120, 'LPG', 2, 1, 4, 0, 0, 3),
      (2, 'LPG-22', 'Brand B', '22 kg LPG', '22 kg', 10, 200, 240, 'LPG', 10, 2, 3, 1, 1, 3);
    INSERT INTO categorytbl VALUES (1, 'LPG', 'Y');
    INSERT INTO invetorycounttbl VALUES
      ('LPG-11', '11 kg LPG', 4, 1, '2026-08-31', 'SYSTEM', 0, 0, 'LPG'),
      ('LPG-22', '22 kg LPG', 10, 2, '2026-08-31', 'SYSTEM', 0, 0, 'LPG'),
      ('LPG-11', '11 kg LPG', 2, 1, '2026-09-30', 'SYSTEM', 0, 0, 'LPG'),
      ('LPG-22', '22 kg LPG', 10, 2, '2026-09-30', 'SYSTEM', 0, 0, 'LPG');
    INSERT INTO inventory_cost_receipts VALUES
      (1, 1, 'LPG-11', 'STORE', 'FULL', 2, 180, 90, '2026-08-20 08:00:00'),
      (2, 1, 'LPG-11', 'STORE', 'FULL', 5, 500, 100, '2026-09-15 10:00:00');
    INSERT INTO pricelisttbl VALUES
      (1, 450, 1200),
      (2, 850, 2400);
    INSERT INTO itemhistorytbl VALUES
      (1, '2026-09-10 10:00:00', 'LPG-11', 'SALE-2', 'STORE', -2,
       'SOLD FULL ITEM', 4, 2);
    INSERT INTO inventory_adjustments VALUES
      (1, 1, 'FULL', 1, 1, 2, 'Physical count', 'Count correction', 'Owner',
       '2026-09-20 09:00:00');
    INSERT INTO custinfo VALUES
      (1, 'Customer One', '09170000000', 75, 'active'),
      (2, 'Customer Two', '09170000001', 0, 'active');
    INSERT INTO customer_groups VALUES (1, 'Retail');
    INSERT INTO customer_group_members VALUES (1, 1);
    INSERT INTO supplier_restock_payments VALUES
      (1, 1, 40, '2026-08-31 15:00:00', 'PAYMENT', 'CASH', '', 'Advance', 'Owner'),
      (2, 1, 200, '2026-09-15 15:00:00', 'PAYMENT', 'BANK TRANSFER', '', '', 'Owner'),
      (3, 1, 20, '2026-09-16 15:00:00', 'REFUND', 'CASH', '', 'Damaged item', 'Owner'),
      (4, 2, 300, '2026-09-17 15:00:00', 'PAYMENT', 'CASH', '', '', 'Owner');
  `);
  database.close();
}
