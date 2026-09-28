import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSyncSessionDto {
  @ApiProperty({ example: 27 })
  @IsInt()
  @Min(1)
  @Max(10000)
  schemaVersion!: number;

  @ApiProperty({ example: '0.1.1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  applicationVersion!: string;

  @ApiProperty()
  @IsISO8601()
  snapshotCreatedAt!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  fileSize!: number;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256!: string;
}
