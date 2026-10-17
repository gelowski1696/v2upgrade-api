import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ActorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  actor!: string;
}

export class ManualTokenDto extends ActorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  accessToken!: string;
}

export class SelectPageDto extends ActorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  pageId!: string;
}

export class SaveTemplateDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;

  @IsBoolean()
  autoPublish!: boolean;
}

export class GeneratePostDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  template!: string;

  @IsObject()
  facts!: Record<string, string>;

  @IsString()
  @MaxLength(80)
  tone = 'clear and helpful';

  @IsString()
  @MaxLength(80)
  language = 'English';
}

export class CreatePostDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsBoolean()
  approvalRequired = true;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class HeartbeatDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  displayName!: string;

  @IsIn(['AVAILABLE', 'BUSY', 'AWAY'])
  availability!: string;
}

export class ReplyDto extends ActorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;
}

export class AutomationDto extends ActorDto {
  @IsIn(['OFF', 'FAQ_ONLY', 'ASSISTED'])
  mode!: 'OFF' | 'FAQ_ONLY' | 'ASSISTED';
}

export class SaveFaqDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  question!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  answer!: string;

  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [],
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords: string[] = [];

  @IsBoolean()
  enabled = true;
}

export class SocialListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}

export class SocialSearchQueryDto extends SocialListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class LinkCustomerDto extends ActorDto {
  @IsInt()
  @Min(1)
  posCustomerId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  customerName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerContact?: string;
}

export class QuoteLineDto {
  @IsInt()
  @Min(1)
  posItemId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  itemCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  itemName!: string;

  @IsString()
  @MaxLength(120)
  itemSize = '';

  @IsIn(['REFILL', 'NON-REFILL'])
  unit!: 'REFILL' | 'NON-REFILL';

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPriceMinor!: number;

  @IsOptional()
  @IsUUID()
  sourceSnapshotId?: string;
}

export class SaveQuoteDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsUUID()
  conversationId!: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  sourceCampaignId?: string;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];

  @IsString()
  @MaxLength(1000)
  notes = '';

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class ImportCompleteDto extends ActorDto {
  @IsInt()
  @Min(1)
  localQueueId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  localQueueReference!: string;
}

export class ImportFailDto extends ActorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class CreateCampaignDto extends ActorDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsUUID()
  signalId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  goal!: string;

  @IsObject()
  facts!: Record<string, string>;

  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(5000, { each: true })
  variants!: string[];

  @IsInt()
  @Min(0)
  @Max(2)
  selectedVariant!: number;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
