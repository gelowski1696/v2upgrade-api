import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { MetaGraphClient } from './meta-graph.client.js';

describe('MetaGraphClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gets a Page token without requesting the removed Page tasks field', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'page-1',
            name: 'Test Page',
            access_token: 'page-token',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ permission: 'pages_manage_posts', status: 'granted' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const client = new MetaGraphClient(
      new ConfigService({ META_GRAPH_VERSION: 'v26.0' }),
    );

    const result = await client.pageCredential('user-token', 'page-1', [
      'CREATE_CONTENT',
    ]);

    const pageUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(pageUrl.searchParams.get('fields')).toBe('id,name,access_token');
    expect(result.tasks).toEqual(['CREATE_CONTENT']);
    expect(result.permissions).toEqual(['pages_manage_posts']);
  });
});
