import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type {
  CreateExpenseDto,
  CreateGroupPaymentDto,
  CreatePaymentDto,
  FinanceListQueryDto,
  FinanceRangeQueryDto,
} from '../../presentation/http/finance/finance.dto.js';

export interface PaymentAllocationView {
  id: string;
  batchId: string | null;
  subscriptionId: string | null;
  renewalId: string | null;
  purpose: string;
  description: string | null;
  amount: string;
  currency: string;
  reference: string | null;
  paidAt: Date;
  notes: string | null;
  status: 'POSTED' | 'VOIDED';
  voidedAt: Date | null;
  voidReason: string | null;
  client: {
    id: string;
    businessName: string;
    group: { id: string; code: string; name: string } | null;
  };
  plan: { id: string; name: string } | null;
  renewal: {
    id: string;
    periodStartsAt: Date;
    periodEndsAt: Date;
  } | null;
}

export interface PaymentListView extends Omit<PaymentAllocationView, 'status'> {
  kind: 'SINGLE' | 'GROUP';
  group: PaymentAllocationView['client']['group'];
  clientCount: number;
  allocations: PaymentAllocationView[];
  status: 'POSTED' | 'VOIDED' | 'PARTIALLY_VOIDED';
}

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
        where: this.paymentWhere(query, range),
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          batchId: true,
          subscriptionId: true,
          renewalId: true,
          amount: true,
          currency: true,
          reference: true,
          paidAt: true,
          notes: true,
          purpose: true,
          description: true,
          status: true,
          voidedAt: true,
          voidReason: true,
          client: {
            select: {
              id: true,
              businessName: true,
              group: { select: { id: true, code: true, name: true } },
            },
          },
          renewal: {
            select: { id: true, periodStartsAt: true, periodEndsAt: true },
          },
          subscription: {
            select: {
              id: true,
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
    const byPurpose = new Map<
      string,
      { purpose: string; revenue: number; payments: number }
    >();
    let revenue = 0;
    for (const payment of postedPayments) {
      const amount = Number(payment.amount);
      revenue += amount;
      const day = payment.paidAt.toISOString().slice(0, 10);
      const dailyRow = daily.get(day);
      if (dailyRow) dailyRow.revenue += amount;
      const plan = payment.subscription?.planVersion.plan;
      if (plan) {
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
      const purposeRow = byPurpose.get(payment.purpose) ?? {
        purpose: payment.purpose,
        revenue: 0,
        payments: 0,
      };
      purposeRow.revenue += amount;
      purposeRow.payments += 1;
      byPurpose.set(payment.purpose, purposeRow);
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
      byPurpose: [...byPurpose.values()]
        .map((row) => ({ ...row, revenue: this.money(row.revenue) }))
        .sort((left, right) => right.revenue - left.revenue),
      recentPayments: payments
        .slice(0, 10)
        .map((payment) => this.paymentRecord(payment)),
    };
  }

  async payments(query: FinanceListQueryDto) {
    const range = this.range(query);
    const where = this.paymentWhere(query, range);
    const payments = await this.prisma.paymentRecord.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        batchId: true,
        subscriptionId: true,
        renewalId: true,
        purpose: true,
        description: true,
        amount: true,
        currency: true,
        reference: true,
        paidAt: true,
        notes: true,
        status: true,
        voidedAt: true,
        voidReason: true,
        client: {
          select: {
            id: true,
            businessName: true,
            group: { select: { id: true, code: true, name: true } },
          },
        },
        renewal: {
          select: { id: true, periodStartsAt: true, periodEndsAt: true },
        },
        subscription: {
          select: {
            id: true,
            planVersion: {
              select: { plan: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    const logicalItems: PaymentListView[] = [];
    const batches = new Map<string, PaymentListView>();
    for (const payment of payments) {
      const allocation = this.paymentAllocation(payment);
      if (!payment.batchId) {
        logicalItems.push({
          ...allocation,
          kind: 'SINGLE',
          group: allocation.client.group,
          clientCount: 1,
          allocations: [],
          status: allocation.status,
        });
        continue;
      }
      let batch = batches.get(payment.batchId);
      if (!batch) {
        const newBatch: PaymentListView = {
          ...allocation,
          id: `batch:${payment.batchId}`,
          kind: 'GROUP',
          group: allocation.client.group,
          clientCount: 0,
          amount: '0.00',
          plan: null,
          renewal: null,
          status: allocation.status,
          allocations: [],
        };
        batches.set(payment.batchId, newBatch);
        logicalItems.push(newBatch);
        batch = newBatch;
      }
      batch.allocations.push(allocation);
      batch.clientCount = batch.allocations.length;
      batch.amount = (
        batch.allocations.reduce(
          (total, item) => total + Math.round(Number(item.amount) * 100),
          0,
        ) / 100
      ).toFixed(2);
      const postedCount = batch.allocations.filter(
        (item) => item.status === 'POSTED',
      ).length;
      batch.status =
        postedCount === batch.allocations.length
          ? 'POSTED'
          : postedCount === 0
            ? 'VOIDED'
            : 'PARTIALLY_VOIDED';
    }
    const total = logicalItems.length;
    const start = (query.page - 1) * query.pageSize;
    const items = logicalItems.slice(start, start + query.pageSize);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
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
    const client = await this.prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found.');
    const subscription = input.subscriptionId
      ? await this.prisma.subscription.findUnique({
          where: { id: input.subscriptionId },
          select: { id: true, clientId: true, currency: true, deletedAt: true },
        })
      : null;
    if (input.subscriptionId && (!subscription || subscription.deletedAt)) {
      throw new NotFoundException('Subscription not found.');
    }
    if (subscription && subscription.clientId !== client.id) {
      throw new BadRequestException(
        'The selected subscription does not belong to this client.',
      );
    }
    if (input.purpose === 'RENEWAL' && !subscription) {
      throw new BadRequestException('Renewal payments require a subscription.');
    }
    const description = this.optional(input.description);
    if (
      (input.purpose === 'MODIFICATION' || input.purpose === 'OTHER') &&
      !description
    ) {
      throw new BadRequestException(
        'Modification and other payments require a description.',
      );
    }
    const renewal = input.renewalId
      ? await this.prisma.subscriptionRenewal.findUnique({
          where: { id: input.renewalId },
          select: { id: true, subscriptionId: true },
        })
      : null;
    if (input.renewalId && !renewal) {
      throw new NotFoundException('Subscription renewal not found.');
    }
    if (renewal && renewal.subscriptionId !== subscription?.id) {
      throw new BadRequestException(
        'The selected renewal does not belong to this subscription.',
      );
    }
    const currency = input.currency ?? subscription?.currency ?? 'PHP';
    if (subscription && currency !== subscription.currency) {
      throw new BadRequestException(
        `Payment currency must be ${subscription.currency}.`,
      );
    }
    const payment = await this.prisma.paymentRecord.create({
      data: {
        clientId: client.id,
        subscriptionId: subscription?.id,
        renewalId: renewal?.id,
        purpose: input.purpose,
        description,
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
        clientId: client.id,
        subscriptionId: subscription?.id,
        renewalId: renewal?.id,
        purpose: input.purpose,
        amount: input.amount,
        currency,
      },
    });
    return {
      ...payment,
      amount: payment.amount.toFixed(2),
    };
  }

  async createGroupPayment(input: CreateGroupPaymentDto, actorId: string) {
    const description = this.optional(input.description);
    if (
      (input.purpose === 'MODIFICATION' || input.purpose === 'OTHER') &&
      !description
    ) {
      throw new BadRequestException(
        'Modification and other payments require a description.',
      );
    }
    for (const allocation of input.allocations) {
      this.positiveAmount(allocation.amount);
    }

    const group = await this.prisma.clientGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, name: true, status: true },
    });
    if (!group) throw new NotFoundException('Client group not found.');
    if (group.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Payments cannot be recorded for an archived client group.',
      );
    }

    const clientIds = input.allocations.map(
      (allocation) => allocation.clientId,
    );
    const clients = await this.prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, groupId: true },
    });
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    for (const clientId of clientIds) {
      const client = clientsById.get(clientId);
      if (!client)
        throw new NotFoundException('One or more clients were not found.');
      if (client.groupId !== group.id) {
        throw new BadRequestException(
          'Every selected client must belong to the selected group.',
        );
      }
    }

    const subscriptionIds = input.allocations
      .map((allocation) => allocation.subscriptionId)
      .filter((id): id is string => Boolean(id));
    const subscriptions = subscriptionIds.length
      ? await this.prisma.subscription.findMany({
          where: { id: { in: subscriptionIds } },
          select: { id: true, clientId: true, currency: true, deletedAt: true },
        })
      : [];
    const subscriptionsById = new Map(
      subscriptions.map((subscription) => [subscription.id, subscription]),
    );

    const renewalIds = input.allocations
      .map((allocation) => allocation.renewalId)
      .filter((id): id is string => Boolean(id));
    const renewals = renewalIds.length
      ? await this.prisma.subscriptionRenewal.findMany({
          where: { id: { in: renewalIds } },
          select: { id: true, subscriptionId: true },
        })
      : [];
    const renewalsById = new Map(
      renewals.map((renewal) => [renewal.id, renewal]),
    );
    const currency = input.currency ?? subscriptions[0]?.currency ?? 'PHP';

    for (const allocation of input.allocations) {
      const subscription = allocation.subscriptionId
        ? subscriptionsById.get(allocation.subscriptionId)
        : undefined;
      if (
        allocation.subscriptionId &&
        (!subscription || subscription.deletedAt)
      ) {
        throw new NotFoundException(
          'One or more subscriptions were not found.',
        );
      }
      if (subscription && subscription.clientId !== allocation.clientId) {
        throw new BadRequestException(
          'Each selected subscription must belong to its allocated client.',
        );
      }
      if (input.purpose === 'RENEWAL' && !subscription) {
        throw new BadRequestException(
          'Every renewal allocation requires a subscription.',
        );
      }
      if (subscription && subscription.currency !== currency) {
        throw new BadRequestException(
          `All selected subscriptions must use ${currency}.`,
        );
      }
      const renewal = allocation.renewalId
        ? renewalsById.get(allocation.renewalId)
        : undefined;
      if (allocation.renewalId && !renewal) {
        throw new NotFoundException(
          'One or more subscription renewals were not found.',
        );
      }
      if (renewal && renewal.subscriptionId !== subscription?.id) {
        throw new BadRequestException(
          'Each selected renewal must belong to its allocated subscription.',
        );
      }
    }

    const batchId = randomUUID();
    const paidAt = new Date(input.paidAt);
    const reference = this.optional(input.reference);
    const notes = this.optional(input.notes);
    const payments = await this.prisma.$transaction(
      input.allocations.map((allocation) =>
        this.prisma.paymentRecord.create({
          data: {
            batchId,
            clientId: allocation.clientId,
            subscriptionId: allocation.subscriptionId,
            renewalId: allocation.renewalId,
            purpose: input.purpose,
            description,
            amount: allocation.amount,
            currency,
            paidAt,
            reference,
            notes,
            createdById: actorId,
          },
          select: { id: true, amount: true },
        }),
      ),
    );
    const totalAmount = payments.reduce(
      (total, payment) => total + Math.round(Number(payment.amount) * 100),
      0,
    );
    await this.audit.record({
      actorId,
      action: 'payment.group_created',
      resourceType: 'payment_batch',
      resourceId: batchId,
      metadata: {
        groupId: group.id,
        groupName: group.name,
        paymentIds: payments.map((payment) => payment.id),
        clientIds,
        purpose: input.purpose,
        amount: (totalAmount / 100).toFixed(2),
        currency,
      },
    });
    return {
      batchId,
      paymentIds: payments.map((payment) => payment.id),
      clientCount: payments.length,
      amount: (totalAmount / 100).toFixed(2),
      currency,
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
        clientId: true,
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
        clientId: payment.clientId,
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

  private paymentWhere(
    query: FinanceRangeQueryDto | FinanceListQueryDto,
    range: ReturnType<FinanceService['range']>,
  ) {
    const search = 'search' in query ? query.search?.trim() : undefined;
    const status = 'status' in query ? query.status : undefined;
    return {
      currency: range.currency,
      paidAt: { gte: range.fromDate, lt: range.toExclusive },
      clientId: query.clientId,
      purpose: query.purpose,
      status,
      client: query.groupId ? { groupId: query.groupId } : undefined,
      ...(search
        ? {
            OR: [
              {
                description: { contains: search, mode: 'insensitive' as const },
              },
              { reference: { contains: search, mode: 'insensitive' as const } },
              {
                client: {
                  businessName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private paymentRecord(payment: {
    id: string;
    batchId?: string | null;
    subscriptionId?: string | null;
    renewalId?: string | null;
    purpose: string;
    description: string | null;
    amount: { toFixed(digits: number): string };
    currency: string;
    reference: string | null;
    paidAt: Date;
    notes: string | null;
    status: string;
    voidedAt: Date | null;
    voidReason: string | null;
    client: {
      id: string;
      businessName: string;
      group: { id: string; code: string; name: string } | null;
    };
    subscription: {
      id: string;
      planVersion: { plan: { id: string; name: string } };
    } | null;
    renewal: {
      id: string;
      periodStartsAt: Date;
      periodEndsAt: Date;
    } | null;
  }): PaymentListView {
    const allocation = this.paymentAllocation(payment);
    return {
      ...allocation,
      kind: 'SINGLE' as const,
      group: allocation.client.group,
      clientCount: 1,
      allocations: [] as PaymentAllocationView[],
    };
  }

  private paymentAllocation(payment: {
    id: string;
    batchId?: string | null;
    subscriptionId?: string | null;
    renewalId?: string | null;
    purpose: string;
    description: string | null;
    amount: { toFixed(digits: number): string };
    currency: string;
    reference: string | null;
    paidAt: Date;
    notes: string | null;
    status: string;
    voidedAt: Date | null;
    voidReason: string | null;
    client: {
      id: string;
      businessName: string;
      group: { id: string; code: string; name: string } | null;
    };
    subscription: {
      id: string;
      planVersion: { plan: { id: string; name: string } };
    } | null;
    renewal: {
      id: string;
      periodStartsAt: Date;
      periodEndsAt: Date;
    } | null;
  }): PaymentAllocationView {
    return {
      id: payment.id,
      batchId: payment.batchId ?? null,
      subscriptionId: payment.subscriptionId ?? null,
      renewalId: payment.renewalId ?? null,
      purpose: payment.purpose,
      description: payment.description,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      reference: payment.reference,
      paidAt: payment.paidAt,
      notes: payment.notes,
      status: payment.status === 'VOIDED' ? 'VOIDED' : 'POSTED',
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      client: payment.client,
      plan: payment.subscription?.planVersion.plan ?? null,
      renewal: payment.renewal,
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
