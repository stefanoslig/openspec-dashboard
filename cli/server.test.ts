import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { WorkspaceError } from './reader.ts';
import { createDashboardServer } from './server.ts';
import type { Workspace } from './workspace.model.ts';

let folder: string;
let server: Server;
let load: () => Promise<Workspace>;
const workspace = { name: 'fixture', documents: [] } as unknown as Workspace;

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'openspec-server-'));
  await mkdir(path.join(folder, 'app'));
  await writeFile(path.join(folder, 'app/index.html'), '<app-root></app-root>');
  await writeFile(path.join(folder, 'app/main.js'), 'console.log(1)');
  await writeFile(path.join(folder, 'secret.txt'), 'outside the app folder');
  server = createDashboardServer({ appDir: path.join(folder, 'app'), load: () => load() });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
after(async () => {
  server.close();
  await rm(folder, { recursive: true, force: true });
});

function send(
  target: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port, path: target, method: options.method, headers: options.headers },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode!, headers: response.headers, body }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('serves the dashboard files and the workspace', async () => {
  load = async () => workspace;
  const page = await send('/');
  assert.equal(page.status, 200);
  assert.equal(page.body, '<app-root></app-root>');
  assert.match(page.headers['content-type']!, /text\/html/);
  assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match((await send('/main.js')).headers['content-type']!, /text\/javascript/);
  const data = await send('/workspace.json?cache=1');
  assert.equal(data.status, 200);
  assert.deepEqual(JSON.parse(data.body), workspace);
  const head = await send('/workspace.json', { method: 'HEAD' });
  assert.deepEqual([head.status, head.body], [200, '']);
});

test('reports workspace errors without leaking unexpected ones', async () => {
  load = async () => {
    throw new WorkspaceError('No openspec folder found.');
  };
  const expected = await send('/workspace.json');
  assert.equal(expected.status, 400);
  assert.deepEqual(JSON.parse(expected.body), { error: 'No openspec folder found.' });
  load = async () => {
    throw new Error('internal detail');
  };
  const original = console.error;
  console.error = () => {};
  try {
    const unexpected = await send('/workspace.json');
    assert.equal(unexpected.status, 500);
    assert.doesNotMatch(unexpected.body, /internal detail/);
  } finally {
    console.error = original;
  }
});

test('rejects foreign hosts, cross-site requests and mutations', async () => {
  load = async () => workspace;
  const { port } = server.address() as AddressInfo;
  const status = async (headers: Record<string, string>, method = 'GET') =>
    (await send('/workspace.json', { headers, method })).status;
  assert.equal(await status({ host: 'evil.example' }), 403);
  assert.equal(await status({ host: 'localhost:' + port }), 200);
  assert.equal(await status({ origin: 'https://evil.example' }), 403);
  assert.equal(await status({ origin: 'http://127.0.0.1:' + port }), 200);
  assert.equal(await status({ 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await status({ 'sec-fetch-site': 'same-origin' }), 200);
  assert.equal(await status({}, 'POST'), 405);
  assert.equal(await status({}, 'DELETE'), 405);
});

test('serves nothing outside the dashboard folder', async () => {
  assert.equal((await send('/..%2fsecret.txt')).status, 404);
  assert.equal((await send('/%2e%2e/secret.txt')).status, 404);
  assert.equal((await send('/../secret.txt')).status, 404);
  assert.equal((await send('/missing.js')).status, 404);
  assert.equal((await send('/artifact')).status, 404);
  assert.equal((await send('/%E0%A4%A')).status, 400);
});
