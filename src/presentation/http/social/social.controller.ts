import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SocialService } from '../../../application/social/social.service.js';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';
import { CurrentDevice } from '../device/current-device.decorator.js';
import { DeviceAuthGuard } from '../device/device-auth.guard.js';
import { SocialEntitlementGuard } from './social-entitlement.guard.js';
import {
  ActorDto,
  AutomationDto,
  CreatePostDto,
  GeneratePostDto,
  HeartbeatDto,
  ManualTokenDto,
  ReplyDto,
  SaveFaqDto,
  SaveTemplateDto,
  SelectPageDto,
  SocialListQueryDto,
} from './social.dto.js';

@ApiTags('Social Hub')
@ApiBearerAuth()
@UseGuards(DeviceAuthGuard, SocialEntitlementGuard)
@Controller('device-social')
export class DeviceSocialController {
  constructor(private readonly social: SocialService) {}

  @Get('connections')
  connections(@CurrentDevice() device: AuthenticatedDevice) {
    return this.social.listConnections(device);
  }

  @Post('meta/oauth/start')
  oauthStart(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: ActorDto,
  ) {
    return this.social.startOAuth(device, input.actor);
  }

  @Get('meta/oauth/attempts/:id')
  oauthAttempt(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.oauthAttempt(device, id);
  }

  @Post('meta/oauth/attempts/:id/select')
  oauthSelect(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SelectPageDto,
  ) {
    return this.social.selectOAuthPage(device, id, input.pageId);
  }

  @Post('meta/token')
  connectWithToken(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: ManualTokenDto,
  ) {
    return this.social.connectWithToken(device, input.accessToken, input.actor);
  }

  @Post('connections/:id/check')
  checkConnection(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.checkConnection(device, id);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  disconnect(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.disconnect(device, id);
  }

  @Get('templates')
  templates(
    @CurrentDevice() device: AuthenticatedDevice,
    @Query() query: SocialListQueryDto,
  ) {
    return this.social.templates(device, query.connectionId);
  }

  @Post('templates')
  saveTemplate(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: SaveTemplateDto,
  ) {
    return this.social.saveTemplate(device, input);
  }

  @Post('posts/generate')
  generatePost(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: GeneratePostDto,
  ) {
    return this.social.generatePost(device, input);
  }

  @Post('posts')
  createPost(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: CreatePostDto,
  ) {
    return this.social.createPost(device, input);
  }

  @Get('posts')
  posts(
    @CurrentDevice() device: AuthenticatedDevice,
    @Query() query: SocialListQueryDto,
  ) {
    return this.social.posts(device, query.connectionId);
  }

  @Post('posts/:id/approve')
  approvePost(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ActorDto,
  ) {
    return this.social.approvePost(device, id, input.actor);
  }

  @Post('posts/:id/cancel')
  cancelPost(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.cancelPost(device, id);
  }

  @Post('posts/:id/retry')
  retryPost(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.retryPost(device, id);
  }

  @Post('inbox/heartbeat')
  heartbeat(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: HeartbeatDto,
  ) {
    return this.social.heartbeat(device, input);
  }

  @Get('conversations')
  conversations(
    @CurrentDevice() device: AuthenticatedDevice,
    @Query() query: SocialListQueryDto,
  ) {
    return this.social.conversations(device, query.connectionId);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.messages(device, id);
  }

  @Post('conversations/:id/claim')
  claim(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ActorDto,
  ) {
    return this.social.claimConversation(device, id, input.actor);
  }

  @Post('conversations/:id/release')
  release(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ActorDto,
  ) {
    return this.social.releaseConversation(device, id, input.actor);
  }

  @Post('conversations/:id/replies')
  reply(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReplyDto,
  ) {
    return this.social.reply(device, id, input.text, input.actor);
  }

  @Post('conversations/:id/suggest-reply')
  suggestReply(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.social.suggestReply(device, id);
  }

  @Post('conversations/:id/resolve')
  resolve(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ActorDto,
  ) {
    return this.social.resolveConversation(device, id, input.actor);
  }

  @Post('conversations/:id/automation')
  automation(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: AutomationDto,
  ) {
    return this.social.setAutomation(device, id, input.mode);
  }

  @Get('faqs')
  faqs(
    @CurrentDevice() device: AuthenticatedDevice,
    @Query() query: SocialListQueryDto,
  ) {
    return this.social.faqs(device, query.connectionId);
  }

  @Post('faqs')
  saveFaq(
    @CurrentDevice() device: AuthenticatedDevice,
    @Body() input: SaveFaqDto,
  ) {
    return this.social.saveFaq(device, input);
  }
}

@ApiTags('Meta callbacks')
@Controller()
export class MetaCallbackController {
  constructor(private readonly social: SocialService) {}

  @Get('social/meta/oauth/callback')
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const result = await this.social.completeOAuthCallback({
      state,
      code,
      error,
      errorDescription,
    });
    response
      .status(result.success ? 200 : 400)
      .type('html')
      .send(this.callbackHtml(result.success, result.message));
  }

  @Get('webhooks/meta')
  verifyWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ) {
    const value = this.social.webhookChallenge(mode, verifyToken, challenge);
    if (!value) throw new ForbiddenException('Webhook verification failed.');
    response.status(200).send(value);
  }

  @Post('webhooks/meta')
  @HttpCode(200)
  webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    if (!this.social.verifyWebhookSignature(request.rawBody, signature)) {
      throw new ForbiddenException('Webhook signature is invalid.');
    }
    return this.social.ingestWebhook(request.body as Record<string, unknown>);
  }

  private callbackHtml(success: boolean, message: string): string {
    const safe = message
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VMJAM Social Hub</title><style>body{margin:0;background:#071b1b;color:#f5fbfa;font-family:Inter,system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.panel{max-width:560px;padding:48px}.mark{color:#50d5c3;font-weight:800;letter-spacing:.12em}h1{font-size:32px;margin:16px 0 12px}p{color:#b8cfcb;line-height:1.6}.status{display:inline-block;margin-top:20px;padding:9px 13px;border:1px solid ${success ? '#2d8f80' : '#a34d55'};border-radius:6px;color:${success ? '#7ce5d5' : '#ffadb4'}}</style></head><body><main class="panel"><div class="mark">VMJAM SALES</div><h1>${success ? 'Facebook connected' : 'Connection not completed'}</h1><p>${safe}</p><span class="status">You may close this window</span></main></body></html>`;
  }
}
