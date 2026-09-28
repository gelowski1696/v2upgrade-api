import type { Page, PageQuery } from '../shared/page.js';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type BillingInterval =
  'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'CUSTOM';

export interface PlanVersionRecord {
  id: string;
  planId: string;
  version: number;
  billingInterval: BillingInterval;
  amount: string;
  currency: string;
  trialDays: number;
  graceDays: number;
  maxDevices: number;
  features: Record<string, unknown>;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface PlanRecord {
  id: string;
  code: string;
  name: string;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
  versions: PlanVersionRecord[];
}

export interface PlanVersionInput {
  billingInterval: BillingInterval;
  amount: string;
  currency?: string;
  trialDays?: number;
  graceDays?: number;
  maxDevices?: number;
  features?: Record<string, unknown>;
}

export interface CreatePlanInput extends PlanVersionInput {
  code: string;
  name: string;
}

export const PLAN_REPOSITORY = Symbol('PLAN_REPOSITORY');

export interface PlanRepository {
  list(query: PageQuery & { status?: PlanStatus }): Promise<Page<PlanRecord>>;
  findById(id: string): Promise<PlanRecord | null>;
  findByCode(code: string): Promise<PlanRecord | null>;
  findVersion(id: string): Promise<PlanVersionRecord | null>;
  create(input: CreatePlanInput): Promise<PlanRecord>;
  addVersion(
    planId: string,
    input: PlanVersionInput,
  ): Promise<PlanVersionRecord>;
  publishVersion(planId: string, versionId: string): Promise<PlanRecord>;
  archive(id: string): Promise<PlanRecord>;
}
