import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsNotEmpty,
  IsObject,
  IsBoolean,
  Matches,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { SubscriptionStatus } from '../../../domain/subscriptions/subscription.repository.js';
import { PageQueryDto } from '../common/page-query.dto.js';

const subscriptionStatuses = {
  DRAFT: 'DRAFT',
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  GRACE: 'GRACE',
  SUSPENDED: 'SUSPENDED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export class SubscriptionPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: Object.values(subscriptionStatuses) })
  @IsOptional()
  @IsEnum(subscriptionStatuses)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty()
  @IsUUID()
  planVersionId!: string;

  @ApiProperty({ example: 'POS-7F73A16C-1E56-4F29-93C9-77A25C061552' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/, {
    message:
      'deviceId must be 8-120 letters, numbers, dots, underscores, colons, or dashes',
  })
  deviceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  featureOverrides?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  webDashboardEnabled?: boolean;
}

export class ValidateDeviceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/)
  deviceId!: string;
}

export class UpdateFeatureModsDto {
  @ApiProperty({ type: Object })
  @IsObject()
  features!: Record<string, unknown>;
}

export class UpdateWebDashboardDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateSubscriptionFeaturesDto extends UpdateFeatureModsDto {
  @ApiProperty()
  @IsBoolean()
  webDashboardEnabled!: boolean;
}

export class SubscriptionActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RenewSubscriptionDto extends SubscriptionActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  periodStartsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  periodEndsAt?: string;
}
