import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  BillingInterval,
  PlanStatus,
} from '../../../domain/plans/plan.repository.js';
import { PageQueryDto } from '../common/page-query.dto.js';

const planStatuses = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
const billingIntervals = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMIANNUAL: 'SEMIANNUAL',
  ANNUAL: 'ANNUAL',
  CUSTOM: 'CUSTOM',
} as const;

export class PlanPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: Object.values(planStatuses) })
  @IsOptional()
  @IsEnum(planStatuses)
  status?: PlanStatus;
}

export class PlanVersionDto {
  @ApiProperty({ enum: Object.values(billingIntervals) })
  @IsEnum(billingIntervals)
  billingInterval!: BillingInterval;

  @ApiProperty({ example: '1499.00' })
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  amount!: string;

  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxDevices?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;
}

export class CreatePlanDto extends PlanVersionDto {
  @ApiProperty({ example: 'STANDARD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Standard' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
