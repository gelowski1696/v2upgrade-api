import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Matches,
  Min,
} from 'class-validator';

export const PORTAL_OVERVIEW_METRICS = [
  'GROSS_SALES',
  'RECORDED_GROSS_PROFIT',
  'CUSTOMER_BALANCE',
  'INVENTORY_ALERTS',
] as const;

export const PORTAL_SAVED_VIEW_REPORTS = [
  'overview',
  'sales',
  'inventory',
  'inventory-forecast',
  'transfers',
  'balances',
  'cash-flow',
  'restocks',
  'products',
  'profitability',
  'payments',
  'business',
  'inventory-summary',
  'financial-report',
  'discount-report',
  'purchase-report',
  'special-receipts',
  'customer-report',
  'customer-insights',
] as const;

export const PORTAL_DATE_PRESETS = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'CUSTOM',
] as const;

export const PORTAL_ACTIVITY_ACTIONS = [
  'SECURITY',
  'STORE_SYNC',
  'SETTINGS',
  'REPORTING',
  'BACKUP',
] as const;

export class PortalDateRangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export const PORTAL_INVENTORY_FORECAST_RISKS = [
  'OUT_OF_STOCK',
  'REORDER_NOW',
  'WATCH',
  'HEALTHY',
  'NO_RECENT_SALES',
] as const;

export class PortalReportQueryDto extends PortalDateRangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  payment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  itemCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ enum: ['OUT_OF_STOCK', 'CRITICAL', 'HEALTHY'] })
  @IsOptional()
  @IsIn(['OUT_OF_STOCK', 'CRITICAL', 'HEALTHY'])
  stockStatus?: 'OUT_OF_STOCK' | 'CRITICAL' | 'HEALTHY';

  @ApiPropertyOptional({ enum: [7, 14, 30], default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 14, 30])
  forecastDays = 14;

  @ApiPropertyOptional({ enum: PORTAL_INVENTORY_FORECAST_RISKS })
  @IsOptional()
  @IsIn(PORTAL_INVENTORY_FORECAST_RISKS)
  risk?: (typeof PORTAL_INVENTORY_FORECAST_RISKS)[number];

  @ApiPropertyOptional({
    enum: ['PROFIT', 'MARGIN', 'REVENUE'],
    default: 'PROFIT',
  })
  @IsOptional()
  @IsIn(['PROFIT', 'MARGIN', 'REVENUE'])
  profitabilitySort?: 'PROFIT' | 'MARGIN' | 'REVENUE';

  @ApiPropertyOptional({
    enum: ['SPEND', 'VISITS', 'RECENT', 'BALANCE'],
    default: 'SPEND',
  })
  @IsOptional()
  @IsIn(['SPEND', 'VISITS', 'RECENT', 'BALANCE'])
  customerSort?: 'SPEND' | 'VISITS' | 'RECENT' | 'BALANCE';
}

export class PortalSalesTrendQueryDto extends PortalDateRangeDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  group: 'day' | 'week' | 'month' = 'day';
}

export class PortalPageQueryDto extends PortalReportQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class PortalActivityQueryDto extends PortalDateRangeDto {
  @ApiPropertyOptional({ enum: PORTAL_ACTIVITY_ACTIONS })
  @IsOptional()
  @IsIn(PORTAL_ACTIVITY_ACTIONS)
  action?: (typeof PORTAL_ACTIVITY_ACTIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class PortalInventoryForecastQueryDto extends PortalPageQueryDto {}

export class PortalSalesTargetQueryDto {
  @ApiProperty({ example: '2026-09' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class UpdatePortalSalesTargetDto extends PortalSalesTargetQueryDto {
  @ApiProperty({ minimum: 0, maximum: 999999999999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  salesTarget!: number;

  @ApiProperty({ minimum: 0, maximum: 999999999999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  recordedGrossProfitTarget!: number;
}

export class UpdatePortalOverviewPreferencesDto {
  @ApiProperty({ enum: PORTAL_OVERVIEW_METRICS, isArray: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(PORTAL_OVERVIEW_METRICS, { each: true })
  overviewMetrics!: (typeof PORTAL_OVERVIEW_METRICS)[number][];
}

export class SavePortalViewDto {
  @ApiProperty({ example: 'Weekly sales review' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: PORTAL_SAVED_VIEW_REPORTS })
  @IsIn(PORTAL_SAVED_VIEW_REPORTS)
  report!: (typeof PORTAL_SAVED_VIEW_REPORTS)[number];

  @ApiProperty()
  @IsString()
  storeId!: string;

  @ApiProperty({ enum: PORTAL_DATE_PRESETS })
  @IsIn(PORTAL_DATE_PRESETS)
  datePreset!: (typeof PORTAL_DATE_PRESETS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @ApiProperty({ type: Object })
  @IsObject()
  filters!: Record<string, unknown>;
}

export const PORTAL_CASH_FLOW_SOURCES = [
  'SALES_RECEIPTS',
  'CREDIT_COLLECTIONS',
  'CAPITAL_CASH_IN',
  'PETTY_CASH_OUT',
  'SALARY_PAID',
  'RESTOCK_PAYMENTS',
] as const;

export class PortalCashFlowTransactionsQueryDto extends PortalDateRangeDto {
  @ApiProperty({ enum: PORTAL_CASH_FLOW_SOURCES })
  @IsIn(PORTAL_CASH_FLOW_SOURCES)
  source!: (typeof PORTAL_CASH_FLOW_SOURCES)[number];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
