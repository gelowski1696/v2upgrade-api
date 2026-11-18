import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AcknowledgeMasterDataReleaseDto {
  @ApiProperty({ enum: ['DOWNLOADED', 'VALIDATED', 'REJECTED'] })
  @IsIn(['DOWNLOADED', 'VALIDATED', 'REJECTED'])
  status!: 'DOWNLOADED' | 'VALIDATED' | 'REJECTED';

  @ApiPropertyOptional({ example: '0.2.9' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  applicationVersion?: string;

  @ApiPropertyOptional({ example: 'HASH_MISMATCH' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  errorCode?: string;
}
