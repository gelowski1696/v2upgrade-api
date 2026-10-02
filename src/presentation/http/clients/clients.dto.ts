import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  Matches,
  MaxLength,
} from 'class-validator';
import type { ClientStatus } from '../../../domain/clients/client.repository.js';
import { PageQueryDto } from '../common/page-query.dto.js';

const clientStatuses = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export class ClientPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: Object.values(clientStatuses) })
  @IsOptional()
  @IsEnum(clientStatuses)
  status?: ClientStatus;

  @ApiPropertyOptional({ description: 'Client group UUID or "ungrouped"' })
  @IsOptional()
  @IsString()
  @Matches(
    /^(ungrouped|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  groupId?: string;
}

export class CreateClientDto {
  @ApiProperty({ example: 'CLIENT-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Sample LPG Retailer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  businessName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: Object.values(clientStatuses) })
  @IsOptional()
  @IsEnum(clientStatuses)
  status?: ClientStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;
}

export class AssignClientGroupDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;
}

export class BulkAssignClientGroupDto extends AssignClientGroupDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  clientIds!: string[];
}
