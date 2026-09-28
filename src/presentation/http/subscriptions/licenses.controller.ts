import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from '../../../application/subscriptions/subscriptions.service.js';
import { ValidateDeviceDto } from './subscriptions.dto.js';

@ApiTags('Licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post('validate')
  validate(@Body() input: ValidateDeviceDto) {
    return this.subscriptions.validateDevice(input.deviceId);
  }
}
