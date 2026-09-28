import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PortalScheduledReportsService } from '../../../application/portal/portal-scheduled-reports.service.js';

@ApiTags('Webhooks')
@Controller('webhooks/resend')
export class ResendWebhookController {
  constructor(private readonly schedules: PortalScheduledReportsService) {}

  @Post()
  @HttpCode(204)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
  ): Promise<void> {
    if (!request.rawBody || !id || !timestamp || !signature) {
      throw new BadRequestException('Resend webhook payload is incomplete.');
    }
    await this.schedules.handleResendWebhook(request.rawBody.toString('utf8'), {
      id,
      timestamp,
      signature,
    });
  }
}
