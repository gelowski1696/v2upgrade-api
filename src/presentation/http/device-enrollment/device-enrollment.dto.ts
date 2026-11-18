import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDeviceEnrollmentDto {
  @ApiPropertyOptional({ example: 'Front counter' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ default: 30, minimum: 5, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1_440)
  expiresInMinutes?: number;
}

export class ConsumeDeviceEnrollmentDto {
  @ApiProperty({ example: 'VMJAM-ABCD-EFGH-IJKL-MNOP-QRST' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(70)
  enrollmentCode!: string;

  @ApiProperty({ example: 'POS-7F73A16C-1E56-4F29-93C9-77A25C061552' })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/)
  installationId!: string;

  @ApiPropertyOptional({ example: 'Front counter' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ example: 'windows' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  platform!: string;

  @ApiPropertyOptional({ example: '0.2.9' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
