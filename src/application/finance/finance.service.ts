import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type {
  CreateExpenseDto,
  CreatePaymentDto,
  FinanceListQueryDto,
  FinanceRangeQueryDto,
} from '../../presentation/http/finance/finance.dto.js';

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  async overview(query: FinanceRangeQueryDto) {
    const range = this.range(query);
    const [payments, expenses] = await Promise.all([
      this.prisma.paymentRecord.findMany({
        where: {
          currency: range.currency,
          paidAt: { gte: range.fromDate, lt: range.toExclusive },
        },
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          reference: true,
          paidAt: true,
          notes: true,
          status: true,
          voidedAt: true,
          voidReason: true,
          subscription: {
            select: {
              id: true,
              client: { select: { id: true, businessName: true } },
              planVersion: {
                select: { plan: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          currency: range.currency,
          incurredAt: { gte: range.fromDate, lt: range.toExclusive },
        },
        orderBy: { incurredAt: 'desc' },
      }),
    ]);
    const postedPayments = payments.filter(
      (payment) => payment.status === 'POSTED',
    );

    const daily = new Map<
      string,
      { day: string; revenue: number; expenses: number; netIncome: number }
    >();
    for (
      let cursor = new Date(range.fromDate);
      cursor < range.toExclusive;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const day = cursor.toISOString().slice(0, 10);
      daily.set(day, { day, revenue: 0, expenses: 0, netIncome: 0 });
    }

    const byPlan = new Map<
      string,
      { planId: string; planName: string; revenue: number; payments: number }
    >();
    let revenue = 0;
    for (const payment of postedPayments) {
      const amount = Number(payment.amount);
      revenue += amount;
      const day = payment.paidAt.toISOString().slice(0, 10);
      const dailyRow = daily.get(day);
      if (dailyRow) dailyRow.revenue += amount;
      const plan = payment.subscription.planVersion.plan;
      const planRow = byPlan.get(plan.id) ?? {
        planId: plan.id,
        planName: plan.name,
        revenue: 0,
        payments: 0,
      };
      planRow.revenue += amount;
      planRow.payments += 1;
      byPlan.set(plan.id, planRow);
    }

    let expenseTotal = 0;
    for (const expense of expenses) {
      const amount = Number(expense.amount);
      expenseTotal += amount;
      const day = expense.incurredAt.toISOString().slice(0, 10);
      const dailyRow = daily.get(day);
      if (dailyRow) dailyRow.expenses += amount;
    }

    const dailyRows = [...daily.values()].map((row) => ({
      ...row,
      revenue: this.money(row.revenue),
      expenses: this.money(row.expenses),
      netIncome: this.money(row.revenue - row.expenses),
    }));

    return {
      range: {
        from: range.from,
        to: range.to,
        timezone: 'UTC' as const,
        currency: range.currency,
      },
      summary: {
        revenue: this.money(revenue),
        expenses: this.money(expenseTotal),
        netIncome: this.money(revenue - expenseTotal),
        paymentCount: postedPayments.length,
        expenseCount: expenses.length,
      },
      daily: dailyRows,
      byPlan: [...byPlan.values()]
        .map((row) => ({ ...row, revenue: this.money(row.revenue) }))
        .sort((left, right) => right.revenue - left.revenue),
      recentPayments: payments.slice(0, 10).map((payment) => ({
        id: payment.id,
        subscriptionId: payment.subscription.id,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        reference: payment.reference,
        paidAt: payment.paidAt,
        notes: payment.notes,
        status: payment.status,
        voidedAt: payment.voidedAt,
        voidReason: payment.voidReason,
        client: payment.subscription.client,
        plan: payment.subscription.planVersion.plan,
      })),
    };
  }

  async expenses(query: FinanceListQueryDto) {
    const range = this.range(query);
    const search = query.search?.trim();
    const where = {
      currency: range.currency,
      incurredAt: { gte: range.fromDate, lt: range.toExclusive },
      ...(search
        ? {
            OR: [
              {
                description: { contains: search, mode: 'insensitive' as const },
              },
              { vendor: { contains: search, mode: 'insensitive' as const } },
              { reference: { contains: search, mode: 'insensitive' as const } },
              { category: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return {
      items: items.map((item) => this.expenseRecord(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async createPayment(input: CreatePaymentDto, actorId: string) {
    this.positiveAmount(input.amount);
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      select: { id: true, currency: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    const currency = input.currency ?? subscription.currency;
    if (currency !== subscription.currency) {
      throw new BadRequestException(
        `Payment currency must be ${subscription.currency}.`,
      );
    }
    const payment = await this.prisma.paymentRecord.create({
      data: {
        subscriptionId: subscription.id,
        amount: input.amount,
        currency,
        paidAt: new Date(input.paidAt),
        reference: this.optional(input.reference),
        notes: this.optional(input.notes),
        createdById: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'payment.created',
      resourceType: 'payment_record',
      resourceId: payment.id,
      metadata: {
        subscriptionId: subscription.id,
        amount: input.amount,
        currency,
      },
    });
    return {
      ...payment,
      amount: payment.amount.toFixed(2),
    };
  }

  async createExpense(input: CreateExpenseDto, actorId: string) {
    this.positiveAmount(input.amount);
    const expense = await this.prisma.expense.create({
      data: {
        category: input.category,
        description: input.description.trim(),
        amount: input.amount,
        currency: input.currency ?? 'PHP',
        incurredAt: new Date(input.incurredAt),
        vendor: this.optional(input.vendor),
        reference: this.optional(input.reference),
        notes: this.optional(input.notes),
        createdById: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'expense.created',
      resourceType: 'expense',
      resourceId: expense.id,
      metadata: {
        category: expense.category,
        amount: input.amount,
        currency: expense.currency,
      },
    });
    return this.expenseRecord(expense);
  }

  async voidPayment(id: string, reason: string, actorId: string) {
    const voidReason = reason.trim();
    if (voidReason.length < 3) {
      throw new BadRequestException(
        'The payment void reason must contain at least 3 characters.',
      );
    }
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { id },
      select: {
        id: true,
        subscriptionId: true,
        amount: true,
        currency: true,
        status: true,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status === 'VOIDED') {
      throw new ConflictException('Payment is already voided.');
    }

    const voidedAt = new Date();
    const claimed = await this.prisma.paymentRecord.updateMany({
      where: { id, status: 'POSTED' },
      data: {
        status: 'VOIDED',
        voidedAt,
        voidedById: actorId,
        voidReason,
      },
    });
    if (!claimed.count) {
      throw new ConflictException('Payment is already voided.');
    }

    await this.audit.record({
      actorId,
      action: 'payment.voided',
      resourceType: 'payment_record',
      resourceId: id,
      metadata: {
        subscriptionId: payment.subscriptionId,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        reason: voidReason,
      },
    });
    return { id, status: 'VOIDED' as const, voidedAt, voidReason };
  }

  async deleteExpense(id: string, actorId: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found.');
    await this.prisma.expense.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'expense.deleted',
      resourceType: 'expense',
      resourceId: id,
      metadata: {
        category: expense.category,
        amount: expense.amount.toFixed(2),
        currency: expense.currency,
      },
    });
    return { deleted: true };
  }

  private range(query: FinanceRangeQueryDto) {
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFromDate = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - 29,
      ),
    );
    const from = query.from ?? defaultFromDate.toISOString().slice(0, 10);
    const to = query.to ?? defaultTo;
    const fromDate = isoDate(from);
    const toDate = isoDate(to);
    if (toDate < fromDate) {
      throw new BadRequestException(
        'The end date must be on or after the start date.',
      );
    }
    const days =
      Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      throw new BadRequestException('Finance ranges cannot exceed 366 days.');
    }
    const toExclusive = new Date(toDate);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    return {
      from,
      to,
      fromDate,
      toExclusive,
      currency: query.currency ?? 'PHP',
    };
  }

  private positiveAmount(value: string): void {
    if (Number(value) <= 0) {
      throw new BadRequestException('Amount must be greater than zero.');
    }
  }

  private optional(value?: string): string | undefined {
    return value?.trim() || undefined;
  }

  private expenseRecord(expense: {
    id: string;
    category: string;
    description: string;
    amount: { toFixed(digits: number): string };
    currency: string;
    incurredAt: Date;
    vendor: string | null;
    reference: string | null;
    notes: string | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return { ...expense, amount: expense.amount.toFixed(2) };
  }

  private money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

function isoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Finance dates must use YYYY-MM-DD.');
  }
  return parsed;
}
