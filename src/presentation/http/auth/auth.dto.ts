import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class WebLoginDto extends LoginDto {
  @ApiProperty({ default: false, required: false })
  @IsOptional()
  @IsBoolean()
  rememberMe = false;
}
