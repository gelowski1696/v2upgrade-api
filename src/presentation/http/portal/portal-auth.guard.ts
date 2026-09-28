import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PortalAuthGuard extends AuthGuard('portal-jwt') {}
