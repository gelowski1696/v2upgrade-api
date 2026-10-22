import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { PortalRole } from '../../../domain/portal/portal-auth.types.js';

export class AdminPortalCandidateQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class AdminPortalInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  username!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  displayName!: string;

  @ApiProperty({ enum: ['OWNER', 'MANAGER', 'VIEWER'] })
  @IsIn(['OWNER', 'MANAGER', 'VIEWER'])
  role!: PortalRole;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  storeIds!: string[];
}

export class AdminPortalAccessUpdateDto {
  @ApiProperty({ enum: ['OWNER', 'MANAGER', 'VIEWER'] })
  @IsIn(['OWNER', 'MANAGER', 'VIEWER'])
  role!: PortalRole;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  storeIds!: string[];
}
