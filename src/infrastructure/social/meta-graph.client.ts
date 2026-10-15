import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface MetaErrorPayload {
  error?: { message?: string; code?: number; type?: string };
}

export interface MetaPageCandidate {
  id: string;
  name: string;
  tasks: string[];
}

export interface MetaPageCredential extends MetaPageCandidate {
  accessToken: string;
  permissions: string[];
}

@Injectable()
export class MetaGraphClient {
  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return Boolean(
      this.config.get<string>('META_APP_ID') &&
      this.config.get<string>('META_APP_SECRET') &&
      this.config.get<string>('META_OAUTH_REDIRECT_URL'),
    );
  }

  authorizationUrl(state: string): string {
    this.requireOAuthConfiguration();
    const version = this.version();
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.searchParams.set('client_id', this.config.get<string>('META_APP_ID')!);
    url.searchParams.set(
      'redirect_uri',
      this.config.get<string>('META_OAUTH_REDIRECT_URL')!,
    );
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set(
      'scope',
      [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'pages_manage_metadata',
        'pages_messaging',
      ].join(','),
    );
    return url.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    this.requireOAuthConfiguration();
    const url = this.graphUrl('/oauth/access_token');
    url.searchParams.set('client_id', this.config.get<string>('META_APP_ID')!);
    url.searchParams.set(
      'client_secret',
      this.config.get<string>('META_APP_SECRET')!,
    );
    url.searchParams.set(
      'redirect_uri',
      this.config.get<string>('META_OAUTH_REDIRECT_URL')!,
    );
    url.searchParams.set('code', code);
    const value = await this.request<{ access_token?: string }>(url);
    if (!value.access_token) {
      throw new BadGatewayException('Meta did not return an access token.');
    }
    return value.access_token;
  }

  async listPages(userAccessToken: string): Promise<MetaPageCandidate[]> {
    const url = this.graphUrl('/me/accounts');
    url.searchParams.set('fields', 'id,name,tasks');
    url.searchParams.set('limit', '100');
    const value = await this.request<{
      data?: Array<{ id?: string; name?: string; tasks?: string[] }>;
    }>(url, userAccessToken);
    return (value.data ?? []).flatMap((page) =>
      page.id && page.name
        ? [{ id: page.id, name: page.name, tasks: page.tasks ?? [] }]
        : [],
    );
  }

  async pageCredential(
    userAccessToken: string,
    pageId: string,
  ): Promise<MetaPageCredential> {
    const url = this.graphUrl(`/${encodeURIComponent(pageId)}`);
    url.searchParams.set('fields', 'id,name,access_token,tasks');
    const page = await this.request<{
      id?: string;
      name?: string;
      access_token?: string;
      tasks?: string[];
    }>(url, userAccessToken);
    if (!page.id || !page.name || !page.access_token) {
      throw new BadRequestException(
        'The selected Page did not return a usable Page access token.',
      );
    }
    return {
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      tasks: page.tasks ?? [],
      permissions: await this.permissions(userAccessToken),
    };
  }

  async inspectPageToken(pageAccessToken: string): Promise<MetaPageCredential> {
    const url = this.graphUrl('/me');
    url.searchParams.set('fields', 'id,name,tasks');
    const page = await this.request<{
      id?: string;
      name?: string;
      tasks?: string[];
    }>(url, pageAccessToken);
    if (!page.id || !page.name) {
      throw new BadRequestException('The token is not a usable Page token.');
    }
    return {
      id: page.id,
      name: page.name,
      accessToken: pageAccessToken,
      tasks: page.tasks ?? [],
      permissions: await this.permissions(pageAccessToken),
    };
  }

  async publishPost(
    pageId: string,
    pageAccessToken: string,
    message: string,
  ): Promise<string> {
    const url = this.graphUrl(`/${encodeURIComponent(pageId)}/feed`);
    const value = await this.request<{ id?: string }>(url, pageAccessToken, {
      method: 'POST',
      body: JSON.stringify({ message }),
      headers: { 'content-type': 'application/json' },
    });
    if (!value.id)
      throw new BadGatewayException('Meta did not return a post ID.');
    return value.id;
  }

  async sendMessage(
    pageId: string,
    pageAccessToken: string,
    participantId: string,
    text: string,
  ): Promise<string> {
    const url = this.graphUrl(`/${encodeURIComponent(pageId)}/messages`);
    const value = await this.request<{ message_id?: string }>(
      url,
      pageAccessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_type: 'RESPONSE',
          recipient: { id: participantId },
          message: { text },
        }),
        headers: { 'content-type': 'application/json' },
      },
    );
    if (!value.message_id) {
      throw new BadGatewayException('Meta did not return a message ID.');
    }
    return value.message_id;
  }

  private async permissions(accessToken: string): Promise<string[]> {
    const url = this.graphUrl('/me/permissions');
    const value = await this.request<{
      data?: Array<{ permission?: string; status?: string }>;
    }>(url, accessToken);
    return (value.data ?? [])
      .filter((item) => item.status === 'granted' && item.permission)
      .map((item) => item.permission!);
  }

  private graphUrl(path: string): URL {
    return new URL(`https://graph.facebook.com/${this.version()}${path}`);
  }

  private version(): string {
    const value = this.config.get<string>('META_GRAPH_VERSION') ?? 'v26.0';
    return /^v\d+\.\d+$/.test(value) ? value : 'v26.0';
  }

  private requireOAuthConfiguration(): void {
    if (!this.configured()) {
      throw new ServiceUnavailableException(
        'Facebook OAuth is not configured on the server.',
      );
    }
  }

  private async request<T>(
    url: URL,
    accessToken?: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException('Meta could not be reached.');
    }
    const value = (await response.json().catch(() => ({}))) as T &
      MetaErrorPayload;
    if (!response.ok) {
      const message = value.error?.message ?? 'Meta rejected the request.';
      if (response.status >= 500 || response.status === 429) {
        throw new BadGatewayException(message);
      }
      throw new BadRequestException(message);
    }
    return value;
  }
}
