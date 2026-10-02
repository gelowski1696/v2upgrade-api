import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { FinanceService } from './finance.service.js';

describe('FinanceService', () => {
  const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('summarizes collected subscription revenue, expenses, and plan mix', async () => {
    const paymentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'payment-1',
        amount: decimal('1499.00'),
        currency: 'PHP',
        reference: 'RECEIPT-1',
        paidAt: new Date('2026-09-03T00:00:00.000Z'),
        notes: null,
        purpose: 'INITIAL',
        description: null,
        status: 'POSTED',
        voidedAt: null,
        voidReason: null,
        client: { id: 'client-1', businessName: 'Store One', group: null },
        renewal: null,
        subscription: {
          id: 'subscription-1',
          planVersion: { plan: { id: 'plan-1', name: 'Standard' } },
        },
      },
      {
        id: 'payment-2',
        amount: decimal('500.00'),
        currency: 'PHP',
        reference: null,
        paidAt: new Date('2026-09-03T12:00:00.000Z'),
        notes: null,
        purpose: 'OTHER',
        description: 'Legacy subscription payment',
        status: 'VOIDED',
        voidedAt: new Date('2026-09-04T00:00:00.000Z'),
        voidReason: 'Duplicate payment',
        client: { id: 'client-2', businessName: 'Store Two', group: null },
        renewal: null,
        subscription: {
          id: 'subscription-2',
          planVersion: { plan: { id: 'plan-1', name: 'Standard' } },
        },
      },
    ]);
    const expenseFindMany = jest.fn().mockResolvedValue([
      {
        id: 'expense-1',
        category: 'INFRASTRUCTURE',
        description: 'Hosting',
        amount: decimal('700.00'),
        currency: 'PHP',
        incurredAt: new Date('2026-09-03T00:00:00.000Z'),
        vendor: null,
        reference: null,
        notes: null,
        createdById: 'actor-1',
        createdAt: new Date('2026-09-03T00:00:00.000Z'),
        updatedAt: new Date('2026-09-03T00:00:00.000Z'),
      },
    ]);
    const prisma = {
      paymentRecord: { findMany: paymentFindMany },
      expense: { findMany: expenseFindMany },
    } as unknown as PrismaService;
    const service = new FinanceService(prisma, audit);

    const result = await service.overview({
      from: '2026-09-01',
      to: '2026-09-05',
      currency: 'PHP',
    });

    expect(result.summary).toEqual({
      revenue: 1499,
      expenses: 700,
      netIncome: 799,
      paymentCount: 1,
      expenseCount: 1,
    });
    expect(result.daily.find((row) => row.day === '2026-09-03')).toEqual({
      day: '2026-09-03',
      revenue: 1499,
      expenses: 700,
      netIncome: 799,
    });
    expect(result.byPlan).toEqual([
      { planId: 'plan-1', planName: 'Standard', revenue: 1499, payments: 1 },
    ]);
    expect(result.byPurpose).toEqual([
      { purpose: 'INITIAL', revenue: 1499, payments: 1 },
    ]);
    expect(result.recentPayments[1]).toEqual(
      expect.objectContaining({
        status: 'VOIDED',
        voidReason: 'Duplicate payment',
      }),
    );
  });

  it('records an expense and writes an audit event', async () => {
    const created = {
      id: 'expense-1',
      category: 'SOFTWARE',
      description: 'Monitoring',
      amount: decimal('450.00'),
      currency: 'PHP',
      incurredAt: new Date('2026-09-30T00:00:00.000Z'),
      vendor: 'Example Vendor',
      reference: null,
      notes: null,
      createdById: 'actor-1',
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
      updatedAt: new Date('2026-09-30T00:00:00.000Z'),
    };
    const create = jest
      .fn<
        (input: {
          data: {
            description: string;
            amount: string;
            vendor?: string;
          };
        }) => Promise<typeof created>
      >()
      .mockResolvedValue(created);
    const prisma = { expense: { create } } as unknown as PrismaService;
    const service = new FinanceService(prisma, audit);

    const result = await service.createExpense(
      {
        category: 'SOFTWARE',
        description: ' Monitoring ',
        amount: '450.00',
        incurredAt: '2026-09-30T00:00:00.000Z',
        vendor: ' Example Vendor ',
      },
      'actor-1',
    );

    expect(create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        description: 'Monitoring',
        amount: '450.00',
        vendor: 'Example Vendor',
      }),
    );
    expect(result.amount).toBe('450.00');
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        action: 'expense.created',
        resourceId: 'expense-1',
      }),
    );
  });

  it('records a client modification payment without requiring a subscription', async () => {
    const created = {
      id: 'payment-1',
      clientId: 'client-1',
      subscriptionId: null,
      renewalId: null,
      purpose: 'MODIFICATION',
      description: 'Custom invoice layout',
      amount: decimal('2500.00'),
      currency: 'PHP',
      paidAt: new Date('2026-10-02T00:00:00.000Z'),
      reference: null,
      notes: null,
      status: 'POSTED',
      voidedAt: null,
      voidedById: null,
      voidReason: null,
      createdById: 'actor-1',
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    };
    const create = jest
      .fn<
        (input: {
          data: {
            clientId: string;
            subscriptionId?: string;
            purpose: string;
            description?: string;
          };
        }) => Promise<typeof created>
      >()
      .mockResolvedValue(created);
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      paymentRecord: { create },
    } as unknown as PrismaService;
    const service = new FinanceService(prisma, audit);

    const result = await service.createPayment(
      {
        clientId: 'client-1',
        purpose: 'MODIFICATION',
        description: ' Custom invoice layout ',
        amount: '2500.00',
        paidAt: '2026-10-02T00:00:00.000Z',
      },
      'actor-1',
    );

    expect(create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        clientId: 'client-1',
        subscriptionId: undefined,
        purpose: 'MODIFICATION',
        description: 'Custom invoice layout',
      }),
    );
    expect(result.amount).toBe('2500.00');
  });

  it('requires a subscription for renewal payments', async () => {
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue({ id: 'client-1' }) },
    } as unknown as PrismaService;
    const service = new FinanceService(prisma, audit);

    await expect(
      service.createPayment(
        {
          clientId: 'client-1',
          purpose: 'RENEWAL',
          amount: '1499.00',
          paidAt: '2026-10-02T00:00:00.000Z',
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('voids a posted payment without deleting its audit history', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'payment-1',
      subscriptionId: 'subscription-1',
      amount: decimal('1499.00'),
      currency: 'PHP',
      status: 'POSTED',
    });
    const updateMany = jest
      .fn<
        (input: {
          where: { id: string; status: 'POSTED' };
          data: {
            status: 'VOIDED';
            voidedAt: Date;
            voidedById: string;
            voidReason: string;
          };
        }) => Promise<{ count: number }>
      >()
      .mockResolvedValue({ count: 1 });
    const prisma = {
      paymentRecord: { findUnique, updateMany },
    } as unknown as PrismaService;
    const service = new FinanceService(prisma, audit);

    const result = await service.voidPayment(
      'payment-1',
      ' Duplicate payment entry ',
      'actor-1',
    );

    const updated = updateMany.mock.calls[0]?.[0];
    expect(updated?.where).toEqual({ id: 'payment-1', status: 'POSTED' });
    expect(updated?.data).toEqual(
      expect.objectContaining({
        status: 'VOIDED',
        voidedById: 'actor-1',
        voidReason: 'Duplicate payment entry',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'payment-1', status: 'VOIDED' }),
    );
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        action: 'payment.voided',
        resourceId: 'payment-1',
      }),
    );
  });

  it('rejects invalid, reversed, and oversized finance ranges', async () => {
    const prisma = {} as PrismaService;
    const service = new FinanceService(prisma, audit);

    await expect(
      service.overview({ from: '2026-02-31', to: '2026-03-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.overview({ from: '2026-09-30', to: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.overview({ from: '2025-01-01', to: '2026-09-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank payment void reason', async () => {
    const service = new FinanceService({} as PrismaService, audit);

    await expect(
      service.voidPayment('payment-1', '   ', 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function decimal(value: string) {
  return {
    toFixed: () => value,
    valueOf: () => Number(value),
  };
}
