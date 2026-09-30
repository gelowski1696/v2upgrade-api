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
        subscription: {
          id: 'subscription-1',
          client: { id: 'client-1', businessName: 'Store One' },
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
        subscription: {
          id: 'subscription-2',
          client: { id: 'client-2', businessName: 'Store Two' },
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
      revenue: 1999,
      expenses: 700,
      netIncome: 1299,
      paymentCount: 2,
      expenseCount: 1,
    });
    expect(result.daily.find((row) => row.day === '2026-09-03')).toEqual({
      day: '2026-09-03',
      revenue: 1999,
      expenses: 700,
      netIncome: 1299,
    });
    expect(result.byPlan).toEqual([
      { planId: 'plan-1', planName: 'Standard', revenue: 1999, payments: 2 },
    ]);
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
});

function decimal(value: string) {
  return {
    toFixed: () => value,
    valueOf: () => Number(value),
  };
}
