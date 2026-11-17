import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useAuth } from '@/stores/auth';
import { api as path, server } from '@/test/server';
import { api, ApiError, unwrap } from './client';

const refreshed = { accessToken: 'fresh', tokenType: 'Bearer', expiresIn: 900 };
const unauthorized = () =>
  HttpResponse.json({ type: 'x', title: 'Unauthorized', status: 401 }, { status: 401 });

describe('the typed client', () => {
  it('sends the access token and parses JSON', async () => {
    useAuth.setState({ accessToken: 'abc' });
    server.use(
      http.get(path('/users/me'), ({ request }) =>
        HttpResponse.json({ auth: request.headers.get('Authorization') }),
      ),
    );
    await expect(unwrap(api.GET('/api/v1/users/me'))).resolves.toEqual({ auth: 'Bearer abc' });
  });

  it('turns a problem+json body into an ApiError with field errors', async () => {
    server.use(
      http.post(path('/workspaces'), () =>
        HttpResponse.json(
          {
            type: 'x',
            title: 'Validation failed',
            status: 422,
            errors: [{ field: 'slug', message: 'taken' }],
          },
          { status: 422 },
        ),
      ),
    );
    const err: unknown = await unwrap(
      api.POST('/api/v1/workspaces', { body: { name: 'Acme', slug: 'acme' } }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ slug: 'taken' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    useAuth.setState({ accessToken: 'stale' });
    let refreshes = 0;
    server.use(
      http.post(path('/auth/refresh'), () => {
        refreshes += 1;
        return HttpResponse.json(refreshed);
      }),
      http.get(path('/workspaces'), ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ items: [], nextCursor: null })
          : unauthorized(),
      ),
    );

    // Three requests fail together; they must share ONE refresh, or the server sees token reuse.
    const results = await Promise.all([1, 2, 3].map(() => unwrap(api.GET('/api/v1/workspaces'))));
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(1);
    expect(useAuth.getState().accessToken).toBe('fresh');
  });

  it('replays a request body after the refresh', async () => {
    useAuth.setState({ accessToken: 'stale' });
    server.use(
      http.post(path('/auth/refresh'), () => HttpResponse.json(refreshed)),
      http.post(path('/workspaces'), async ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json(await request.json(), { status: 201 })
          : unauthorized(),
      ),
    );
    const body = { name: 'Acme', slug: 'acme' };
    await expect(unwrap(api.POST('/api/v1/workspaces', { body }))).resolves.toEqual(body);
  });

  it('signs out and rethrows when the refresh itself fails', async () => {
    useAuth.setState({ accessToken: 'stale' });
    server.use(
      http.post(path('/auth/refresh'), unauthorized),
      http.get(path('/workspaces'), unauthorized),
    );
    await expect(unwrap(api.GET('/api/v1/workspaces'))).rejects.toMatchObject({ status: 401 });
    expect(useAuth.getState().accessToken).toBeNull();
  });
});
