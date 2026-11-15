import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { PortalRole } from '../../../domain/portal/portal-auth.types.js';

export class CreatePortalInvitationDto {
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
