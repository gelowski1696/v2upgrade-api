import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../common/page-query.dto.js';

const groupStatuses = { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' } as const;

export class ClientGroupPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: Object.values(groupStatuses) })
  @IsOptional()
  @IsEnum(groupStatuses)
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class CreateClientGroupDto {
  @ApiProperty({ example: 'NORTH' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  code!: string;

  @ApiProperty({ example: 'North region' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateClientGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ enum: Object.values(groupStatuses) })
  @IsOptional()
  @IsEnum(groupStatuses)
  status?: 'ACTIVE' | 'ARCHIVED';
}
