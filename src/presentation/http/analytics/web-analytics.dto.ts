import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const webAnalyticsEventTypes = [
  'PAGE_VIEW',
  'FEATURE_USED',
  'FRONTEND_ERROR',
  'API_FAILURE',
  'WEB_VITAL',
] as const;

export const webAnalyticsFeatures = [
  'REPORT_OPENED',
  'REPORT_EXPORTED',
  'STORE_CHANGED',
  'DATE_RANGE_CHANGED',
  'FILTER_APPLIED',
  'SAVED_VIEW_USED',
] as const;

export const webAnalyticsOperations = [
  'SESSION_RESTORE',
  'LOAD_STORES',
  'LOAD_REPORT',
  'EXPORT_REPORT',
  'UPDATE_PREFERENCE',
] as const;

export const webVitalNames = ['LCP', 'INP', 'CLS'] as const;

export class WebAnalyticsEventDto {
  @IsUUID('4')
  eventId!: string;

  @IsIn(webAnalyticsEventTypes)
  type!: (typeof webAnalyticsEventTypes)[number];

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsString()
  @MaxLength(120)
  @Matches(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/)
  route!: string;

  @IsOptional()
  @IsUUID('4')
  storeId?: string;

  @IsOptional()
  @IsIn(webAnalyticsFeatures)
  feature?: (typeof webAnalyticsFeatures)[number];

  @IsOptional()
  @IsIn(webAnalyticsOperations)
  operation?: (typeof webAnalyticsOperations)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/)
  errorCode?: string;

  @IsOptional()
  @IsInt()
  @Min(400)
  @Max(599)
  httpStatus?: number;

  @IsOptional()
  @IsIn(webVitalNames)
  metricName?: (typeof webVitalNames)[number];

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  metricValue?: number;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  appRelease!: string;
}

export class WebAnalyticsBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => WebAnalyticsEventDto)
  events!: WebAnalyticsEventDto[];
}
