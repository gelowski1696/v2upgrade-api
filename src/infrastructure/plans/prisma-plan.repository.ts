import { Injectable } from '@nestjs/common';
import type {
  CreatePlanInput,
  PlanRecord,
  PlanRepository,
  PlanStatus,
  PlanVersionInput,
  PlanVersionRecord,
} from '../../domain/plans/plan.repository.js';
import type { Page, PageQuery } from '../../domain/shared/page.js';
import { toPage } from '../../domain/shared/page.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type PlanWithVersions = Prisma.PlanGetPayload<{ include: { versions: true } }>;
type PrismaPlanVersion = PlanWithVersions['versions'][number];

@Injectable()
export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: PageQuery & { status?: PlanStatus },
  ): Promise<Page<PlanRecord>> {
    const where: Prisma.PlanWhereInput = {
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.plan.findMany({
        where,
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.plan.count({ where }),
    ]);
    return toPage(
      items.map((item) => this.mapPlan(item)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findById(id: string): Promise<PlanRecord | null> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return plan ? this.mapPlan(plan) : null;
  }

  async findByCode(code: string): Promise<PlanRecord | null> {
    const plan = await this.prisma.plan.findUnique({
      where: { code },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return plan ? this.mapPlan(plan) : null;
  }

  async findVersion(id: string): Promise<PlanVersionRecord | null> {
    const version = await this.prisma.planVersion.findUnique({ where: { id } });
    return version ? this.mapVersion(version) : null;
  }

  async create(input: CreatePlanInput): Promise<PlanRecord> {
    const plan = await this.prisma.plan.create({
      data: {
        code: input.code,
        name: input.name,
        versions: {
          create: {
            version: 1,
            billingInterval: input.billingInterval,
            amount: input.amount,
            currency: input.currency ?? 'PHP',
            trialDays: input.trialDays ?? 0,
            graceDays: input.graceDays ?? 7,
            maxDevices: input.maxDevices ?? 1,
            features: (input.features ?? {}) as Prisma.InputJsonValue,
          },
        },
      },
      include: { versions: true },
    });
    return this.mapPlan(plan);
  }

  async addVersion(
    planId: string,
    input: PlanVersionInput,
  ): Promise<PlanVersionRecord> {
    const version = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.planVersion.aggregate({
        where: { planId },
        _max: { version: true },
      });
      return transaction.planVersion.create({
        data: {
          planId,
          version: (result._max.version ?? 0) + 1,
          billingInterval: input.billingInterval,
          amount: input.amount,
          currency: input.currency ?? 'PHP',
          trialDays: input.trialDays ?? 0,
          graceDays: input.graceDays ?? 7,
          maxDevices: input.maxDevices ?? 1,
          features: (input.features ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
    return this.mapVersion(version);
  }

  async publishVersion(planId: string, versionId: string): Promise<PlanRecord> {
    await this.prisma.$transaction([
      this.prisma.planVersion.update({
        where: { id: versionId, planId },
        data: { publishedAt: new Date() },
      }),
      this.prisma.plan.update({
        where: { id: planId },
        data: { status: 'ACTIVE' },
      }),
    ]);
    return (await this.findById(planId)) as PlanRecord;
  }

  async archive(id: string): Promise<PlanRecord> {
    await this.prisma.plan.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    return (await this.findById(id)) as PlanRecord;
  }

  private mapPlan(plan: PlanWithVersions): PlanRecord {
    return {
      ...plan,
      versions: plan.versions.map((version) => this.mapVersion(version)),
    };
  }

  private mapVersion(version: PrismaPlanVersion): PlanVersionRecord {
    return {
      ...version,
      amount: version.amount.toFixed(2),
      features: version.features as Record<string, unknown>,
    };
  }
}
