import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import {
  PLAN_REPOSITORY,
  type CreatePlanInput,
  type PlanRepository,
  type PlanStatus,
  type PlanVersionInput,
} from '../../domain/plans/plan.repository.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';

@Injectable()
export class PlansService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  list(input: {
    page: number;
    pageSize: number;
    search?: string;
    status?: PlanStatus;
  }) {
    return this.plans.list(input);
  }

  async get(id: string) {
    const plan = await this.plans.findById(id);
    if (!plan) throw new NotFoundError('Plan');
    return plan;
  }

  async create(input: CreatePlanInput, actorId: string) {
    const normalized = {
      ...input,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      currency: (input.currency ?? 'PHP').trim().toUpperCase(),
    };
    if (await this.plans.findByCode(normalized.code)) {
      throw new ConflictError(
        'A plan with this code already exists.',
        'PLAN_CODE_EXISTS',
      );
    }
    const plan = await this.plans.create(normalized);
    await this.audit.record({
      actorId,
      action: 'plan.created',
      resourceType: 'plan',
      resourceId: plan.id,
    });
    return plan;
  }

  async addVersion(id: string, input: PlanVersionInput, actorId: string) {
    await this.get(id);
    const version = await this.plans.addVersion(id, input);
    await this.audit.record({
      actorId,
      action: 'plan.version_created',
      resourceType: 'plan',
      resourceId: id,
      metadata: { version: version.version },
    });
    return version;
  }

  async publish(id: string, versionId: string, actorId: string) {
    const plan = await this.get(id);
    const version = await this.plans.findVersion(versionId);
    if (!version || version.planId !== plan.id)
      throw new NotFoundError('Plan version');
    const published = await this.plans.publishVersion(id, versionId);
    await this.audit.record({
      actorId,
      action: 'plan.published',
      resourceType: 'plan',
      resourceId: id,
      metadata: { version: version.version },
    });
    return published;
  }

  async archive(id: string, actorId: string) {
    await this.get(id);
    const plan = await this.plans.archive(id);
    await this.audit.record({
      actorId,
      action: 'plan.archived',
      resourceType: 'plan',
      resourceId: id,
    });
    return plan;
  }
}
