import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

export class GeneratePostDto {
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
