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

  it('gets a Messenger participant name with the Page access token', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'psid-1',
          name: 'Jamie Customer',
          picture: {
            data: { url: 'https://platform-lookaside.fbsbx.com/customer.jpg' },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const client = new MetaGraphClient(
      new ConfigService({ META_GRAPH_VERSION: 'v26.0' }),
    );

    const result = await client.userProfile('psid-1', 'page-token');

    const requestUrl = fetchMock.mock.calls[0]?.[0] as URL;
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestUrl.pathname).toBe('/v26.0/psid-1');
    expect(requestUrl.searchParams.get('fields')).toBe('id,name,picture');
    expect(new Headers(requestInit.headers).get('authorization')).toBe(
      'Bearer page-token',
    );
    expect(result).toEqual({
      id: 'psid-1',
      name: 'Jamie Customer',
      pictureUrl: 'https://platform-lookaside.fbsbx.com/customer.jpg',
    });
  });

  it('checks a Page token without requesting the User permissions edge', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'page-1', name: 'Test Page' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MetaGraphClient(
      new ConfigService({ META_GRAPH_VERSION: 'v26.0' }),
    );

    const result = await client.inspectPageToken(
      'page-token',
      ['pages_manage_posts', 'pages_messaging'],
      ['CREATE_CONTENT', 'MESSAGING'],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestUrl.pathname).toBe('/v26.0/me');
    expect(requestUrl.searchParams.get('fields')).toBe('id,name');
    expect(result.permissions).toEqual([
      'pages_manage_posts',
      'pages_messaging',
    ]);
    expect(result.tasks).toEqual(['CREATE_CONTENT', 'MESSAGING']);
  });
});
