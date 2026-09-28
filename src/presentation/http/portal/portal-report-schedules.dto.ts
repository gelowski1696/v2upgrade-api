import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, IsUUID, Length } from 'class-validator';

export class UpdatePortalReportScheduleDto {
  @ApiProperty()
  @IsUUID()
  storeId!: string;

  @ApiProperty({ enum: ['DAILY', 'WEEKLY'] })
  @IsIn(['DAILY', 'WEEKLY'])
  frequency!: 'DAILY' | 'WEEKLY';

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class ConfirmPortalEmailDto {
  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code!: string;
}
