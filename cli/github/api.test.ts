import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect, failureMessage } from './api.ts';

const permissions =
  ' The workflow needs the permissions "contents: read" and "pull-requests: read".';
const endpoint = {
  graphqlUrl: 'https://api.github.example/graphql',
  token: 't0ken',
  repository: 'acme/roadmap',
};

test('connects to the repository and posts each query with the token', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ data: { viewer: { login: 'mara' } } }));
  };
  const api = connect({ ...endpoint, fetch });
  assert.deepEqual([api.owner, api.name], ['acme', 'roadmap']);
  assert.deepEqual(await api.query('query { viewer { login } }', { first: 1 }), {
    viewer: { login: 'mara' },
  });
  const [{ url, init }] = requests;
  assert.equal(url, endpoint.graphqlUrl);
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    Authorization: 'Bearer t0ken',
    'Content-Type': 'application/json',
    'User-Agent': 'openspec-desk',
  });
  assert.deepEqual(JSON.parse(String(init.body)), {
    query: 'query { viewer { login } }',
    variables: { first: 1 },
  });
});

test('explains an answer that carries no data', async () => {
  const query = (fetch: typeof globalThis.fetch) => connect({ ...endpoint, fetch }).query('{}', {});
  await assert.rejects(
    query(async () => new Response('<html>Sign in</html>')),
    {
      message: 'GitHub answered with something other than GraphQL data.',
    },
  );
  await assert.rejects(
    query(async () => {
      throw new TypeError('fetch failed');
    }),
    { message: 'GitHub could not be reached: fetch failed' },
  );
  await assert.rejects(
    query(
      async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    ),
    { message: 'GitHub answered 401: Bad credentials.' + permissions },
  );
  await assert.rejects(
    query(async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'Oops' }] }))),
    { message: 'GitHub answered: Oops.' },
  );
});

test('words a refusal from the status and the body, with the permissions hint except on rate limits', () => {
  assert.equal(
    failureMessage(403, 'Forbidden', { message: 'Resource not accessible by integration' }),
    'GitHub answered 403: Resource not accessible by integration.' + permissions,
  );
  assert.equal(
    failureMessage(401, 'Unauthorized', { message: 'Bad credentials' }),
    'GitHub answered 401: Bad credentials.' + permissions,
  );
  assert.equal(
    failureMessage(403, 'Forbidden', { message: 'API rate limit exceeded for installation.' }),
    'GitHub answered 403: API rate limit exceeded for installation.',
  );
  assert.equal(
    failureMessage(200, 'OK', {
      data: { repository: null },
      errors: [
        {
          type: 'NOT_FOUND',
          message: "Could not resolve to a Repository with the name 'acme/roadmap'.",
        },
      ],
    }),
    "GitHub answered: Could not resolve to a Repository with the name 'acme/roadmap'.",
  );
  assert.equal(
    failureMessage(200, 'OK', {
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
    }),
    'GitHub answered: Resource not accessible by integration.' + permissions,
  );
  // An HTML body decodes to nothing: the status text is all there is.
  assert.equal(failureMessage(502, 'Bad Gateway', {}), 'GitHub answered 502: Bad Gateway.');
});
