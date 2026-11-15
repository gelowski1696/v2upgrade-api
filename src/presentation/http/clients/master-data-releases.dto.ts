import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const entityTypes = {
  CATEGORY: 'CATEGORY',
  BRAND: 'BRAND',
  CYLINDER_SIZE: 'CYLINDER_SIZE',
  PRODUCT: 'PRODUCT',
  SUPPLIER: 'SUPPLIER',
  PRICE: 'PRICE',
} as const;
const operations = { UPSERT: 'UPSERT', DEACTIVATE: 'DEACTIVATE' } as const;

export class MasterDataReleaseEntryDto {
  @ApiProperty({ enum: Object.values(entityTypes) })
  @IsEnum(entityTypes)
  entityType!: keyof typeof entityTypes;

  @ApiProperty({ enum: Object.values(operations) })
  @IsEnum(operations)
  operation!: keyof typeof operations;

  @ApiProperty({ example: 'PRODUCT-11KG' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  stableKey!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class CreateMasterDataReleaseDto {
  @ApiProperty({ type: [MasterDataReleaseEntryDto] })
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => MasterDataReleaseEntryDto)
  entries!: MasterDataReleaseEntryDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
