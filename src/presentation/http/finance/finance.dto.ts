import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const amountPattern = /^\d{1,10}(\.\d{1,2})?$/;
const currencyPattern = /^[A-Z]{3}$/;

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
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  subscriptionId!: string;

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
