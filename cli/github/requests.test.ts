import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GitHubApi, Page } from './api.ts';
import { gitObjects, listOpenPullRequests, remainingPages } from './requests.ts';

type Json = Record<string, unknown>;

/** An api that answers from a function of the query and its variables, keeping every request. */
function fakeApi(answer: (query: string, variables: Json) => unknown) {
  const requests: { query: string; variables: Json }[] = [];
  const api: GitHubApi = {
    owner: 'acme',
    name: 'roadmap',
    query: async <T>(query: string, variables: Json) => {
      requests.push({ query, variables });
      return answer(query, variables) as T;
    },
  };
  return { api, requests };
}
const page = <T>(nodes: T[], more = false): Page<T> => ({
  pageInfo: { hasNextPage: more, endCursor: more ? '0' : null },
  nodes,
});
/** Pages of 25, `after` the index given, the way GitHub lists pull requests. */
const pagedList = (pulls: Json[]) => (_query: string, variables: Json) => {
  const start = Number(variables.after ?? 0);
  const more = start + 25 < pulls.length;
  return {
    repository: {
      pullRequests: {
        totalCount: pulls.length,
        pageInfo: { hasNextPage: more, endCursor: more ? String(start + 25) : null },
        nodes: pulls.slice(start, start + 25),
      },
    },
  };
};

test('lists the open pull requests page by page, each once, up to 200', async () => {
  const pulls = Array.from({ length: 230 }, (_, at) => ({ number: at + 1 }));
  const { api, requests } = fakeApi(pagedList(pulls));
  const listing = await listOpenPullRequests(api, 'main');
  assert.match(
    requests[0].query,
    /pullRequests\(states: OPEN, baseRefName: \$branch, first: 25, after: \$after, orderBy: \{ field: UPDATED_AT, direction: DESC \}\)/,
  );
  assert.deepEqual(
    requests.map((request) => request.variables),
    [null, '25', '50', '75', '100', '125', '150', '175'].map((after) => ({
      owner: 'acme',
      name: 'roadmap',
      branch: 'main',
      after,
    })),
  );
  assert.deepEqual([listing.listed, listing.total, listing.nodes.length], [200, 230, 200]);
  assert.deepEqual(listing.nodes.at(-1), { number: 200 });

  // An update between two page requests moves a pull request to the front: it is listed again.
  const again = fakeApi(pagedList([...pulls.slice(0, 30), pulls[0]]));
  const twice = await listOpenPullRequests(again.api, 'main');
  assert.deepEqual([twice.listed, twice.total, twice.nodes.length], [31, 31, 30]);
  assert.deepEqual(
    twice.nodes.map((node) => node.number),
    Array.from({ length: 30 }, (_, at) => at + 1),
  );
});

test('follows the remaining pages of one connection of a pull request', async () => {
  const pages = [[{ path: 'b' }], [{ path: 'c' }]];
  const { api, requests } = fakeApi((query, variables) => {
    const key = 'files' in variables ? 'files' : 'threads';
    const at = Number(variables[key]);
    return {
      repository: {
        pullRequest: {
          [key === 'files' ? 'files' : 'reviewThreads']: {
            pageInfo: { hasNextPage: at + 1 < pages.length, endCursor: String(at + 1) },
            nodes: pages[at],
          },
        },
      },
    };
  });
  const files = await remainingPages(api, { number: 7, key: 'files' }, page([{ path: 'a' }], true));
  assert.deepEqual(files, [{ path: 'a' }, { path: 'b' }, { path: 'c' }]);
  assert.match(
    requests[0].query,
    /pullRequest\(number: \$number\) \{ files\(first: 100, after: \$files\)/,
  );
  assert.deepEqual(
    requests.map((request) => request.variables),
    [
      { owner: 'acme', name: 'roadmap', number: 7, files: '0' },
      { owner: 'acme', name: 'roadmap', number: 7, files: '1' },
    ],
  );

  // A complete first page costs no request; threads answer under `reviewThreads`.
  assert.deepEqual(
    await remainingPages(api, { number: 7, key: 'threads' }, page([{ path: 'a' }])),
    [{ path: 'a' }],
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(
    await remainingPages(api, { number: 7, key: 'threads' }, page([{ path: 'a' }], true)),
    [{ path: 'a' }, { path: 'b' }, { path: 'c' }],
  );
  assert.match(requests[2].query, /reviewThreads\(first: 50, after: \$threads\)/);
  assert.deepEqual(requests[2].variables, {
    owner: 'acme',
    name: 'roadmap',
    number: 7,
    threads: '0',
  });
});

test('looks git objects up 50 aliased objects a request, each key once', async () => {
  const { api, requests } = fakeApi((_query, variables) => ({
    repository: Object.fromEntries(
      Object.entries(variables)
        .filter(([key]) => /^v\d+$/.test(key))
        .map(([key, value]) => ['o' + key.slice(1), value === 'missing' ? null : { text: value }]),
    ),
  }));
  const keys = Array.from({ length: 60 }, (_, at) => 'oid' + at);
  const found = await gitObjects<{ text: string }>(
    api,
    { by: 'oid', fields: '... on Blob { text }' },
    [...keys, 'oid0', 'missing'],
  );
  assert.equal(requests.length, 2);
  assert.match(
    requests[0].query,
    /^query\(\$owner: String!, \$name: String!, \$v0: GitObjectID!, \$v1: GitObjectID!, /,
  );
  assert.match(
    requests[0].query,
    /o49: object\(oid: \$v49\) \{ \.\.\. on Blob \{ text \} \}\n {2}\}\n\}$/,
  );
  assert.equal(Object.keys(requests[0].variables).length, 52);
  assert.deepEqual(requests[1].variables, {
    owner: 'acme',
    name: 'roadmap',
    ...Object.fromEntries(keys.slice(50).map((key, at) => ['v' + at, key])),
    v10: 'missing',
  });
  assert.equal(found.size, 61);
  assert.deepEqual(
    [found.get('oid0'), found.get('oid59'), found.get('missing')],
    [{ text: 'oid0' }, { text: 'oid59' }, null],
  );

  // Nothing to look up, nothing asked; an expression is a String.
  assert.deepEqual(await gitObjects(api, { by: 'oid', fields: 'id' }, []), new Map());
  await gitObjects(api, { by: 'expression', fields: '... on Tree { entries { name } }' }, [
    'sha:docs',
  ]);
  assert.equal(requests.length, 3);
  assert.match(
    requests[2].query,
    /^query\(\$owner: String!, \$name: String!, \$v0: String!\) \{\n {2}repository\(owner: \$owner, name: \$name\) \{\n {4}o0: object\(expression: \$v0\) \{ \.\.\. on Tree \{ entries \{ name \} \} \}\n {2}\}\n\}$/,
  );
});
