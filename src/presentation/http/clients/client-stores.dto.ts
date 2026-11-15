import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const storeStatuses = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export class CreateClientStoreDto {
  @ApiProperty({ example: 'NORTH' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/)
  code!: string;

  @ApiProperty({ example: 'North Branch' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional({ default: 'Asia/Manila' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/)
  timezone?: string;
}

export class UpdateClientStoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/)
  timezone?: string;

  @ApiPropertyOptional({ enum: Object.values(storeStatuses) })
  @IsOptional()
  @IsEnum(storeStatuses)
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}
