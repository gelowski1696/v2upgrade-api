import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsEmail,
  IsIn,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PageQueryDto } from '../common/page-query.dto.js';

export const expenseCategories = [
  'INFRASTRUCTURE',
  'SOFTWARE',
  'MARKETING',
  'OPERATIONS',
  'PROFESSIONAL_SERVICES',
  'TAXES',
  'OTHER',
] as const;

export const paymentPurposes = [
  'INITIAL',
  'RENEWAL',
  'MODIFICATION',
  'OTHER',
] as const;

export const paymentStatuses = ['POSTED', 'VOIDED'] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const amountPattern = /^\d{1,10}(\.\d{1,2})?$/;
const currencyPattern = /^[A-Z]{3}$/;
export const billingStatementTargets = ['CLIENT', 'GROUP'] as const;

export class FinanceRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(datePattern)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(datePattern)
  to?: string;

  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @Matches(currencyPattern)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ enum: paymentPurposes })
  @IsOptional()
  @IsIn(paymentPurposes)
  purpose?: (typeof paymentPurposes)[number];
}

export class FinanceListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(datePattern)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(datePattern)
  to?: string;

  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @Matches(currencyPattern)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ enum: paymentPurposes })
  @IsOptional()
  @IsIn(paymentPurposes)
  purpose?: (typeof paymentPurposes)[number];

  @ApiPropertyOptional({ enum: paymentStatuses })
  @IsOptional()
  @IsIn(paymentStatuses)
  status?: (typeof paymentStatuses)[number];
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty({ enum: paymentPurposes })
  @IsIn(paymentPurposes)
  purpose!: (typeof paymentPurposes)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  renewalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @ApiProperty({ example: '1499.00' })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiPropertyOptional({ example: 'PHP' })
  @IsOptional()
  @Matches(currencyPattern)
  currency?: string;

  @ApiProperty({ example: '2026-09-30T02:30:00.000Z' })
  @IsISO8601()
  paidAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class GroupPaymentAllocationDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  renewalId?: string;

  @ApiProperty({ example: '1499.00' })
  @IsString()
  @Matches(amountPattern)
  amount!: string;
}

export class CreateGroupPaymentDto {
  @ApiProperty()
  @IsUUID()
  groupId!: string;

  @ApiProperty({ enum: paymentPurposes })
  @IsIn(paymentPurposes)
  purpose!: (typeof paymentPurposes)[number];

  @ApiProperty({ type: [GroupPaymentAllocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((allocation: GroupPaymentAllocationDto) => allocation.clientId)
  @ValidateNested({ each: true })
  @Type(() => GroupPaymentAllocationDto)
  allocations!: GroupPaymentAllocationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @ApiPropertyOptional({ example: 'PHP' })
  @IsOptional()
  @Matches(currencyPattern)
  currency?: string;

  @ApiProperty({ example: '2026-10-03T00:00:00.000Z' })
  @IsISO8601()
  paidAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class VoidPaymentDto {
  @ApiProperty({ example: 'Duplicate payment entry' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(250)
  reason!: string;
}

export class CreateExpenseDto {
  @ApiProperty({ enum: expenseCategories })
  @IsIn(expenseCategories)
  category!: (typeof expenseCategories)[number];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  description!: string;

  @ApiProperty({ example: '2500.00' })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiPropertyOptional({ example: 'PHP' })
  @IsOptional()
  @Matches(currencyPattern)
  currency?: string;

  @ApiProperty({ example: '2026-09-30T02:30:00.000Z' })
  @IsISO8601()
  incurredAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class BillingStatementPreviewQueryDto {
  @ApiProperty({ enum: billingStatementTargets })
  @IsIn(billingStatementTargets)
  targetType!: (typeof billingStatementTargets)[number];

  @ApiProperty()
  @IsUUID()
  targetId!: string;
}

export class SendBillingStatementDto extends BillingStatementPreviewQueryDto {
  @ApiProperty({ example: 'billing@example.com' })
  @IsEmail()
  @MaxLength(180)
  recipientEmail!: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  rememberEmail!: boolean;

  @ApiProperty({ example: '2026-10-04' })
  @Matches(datePattern)
  statementDate!: string;

  @ApiPropertyOptional({ example: '2026-10-11' })
  @IsOptional()
  @Matches(datePattern)
  dueDate?: string;

  @ApiProperty({ example: 'October 2026 LPG POS System Billing Statement' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  subject!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
