import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WorkspaceError } from './reader.ts';
import type { Workspace } from './workspace.model.ts';

export interface ServerOptions {
  /** Folder with the built dashboard. */
  appDir: string;
  /** Reads the workspace; called for every /workspace.json request. */
  load: () => Promise<Workspace>;
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const contentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': contentTypes['.json'],
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(request.method === 'HEAD' ? undefined : payload);
}

function hostname(request: IncomingMessage): string {
  try {
    return new URL('http://' + request.headers.host).hostname;
  } catch {
    return '';
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', contentSecurityPolicy);
  const reject = (status: number, error: string) => sendJson(request, response, status, { error });

  // The host check stops DNS rebinding; the next two stop other sites reading local files.
  if (!['localhost', '127.0.0.1'].includes(hostname(request)))
    return reject(403, 'Local access only.');
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== 'http://' + request.headers.host)
    return reject(403, 'Cross-origin access is disabled.');
  if (request.headers['sec-fetch-site'] === 'cross-site')
    return reject(403, 'Cross-site access is disabled.');
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return reject(405, 'This dashboard is read-only.');

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    return reject(400, 'Malformed address.');
  }
  if (pathname === '/workspace.json') {
    try {
      return sendJson(request, response, 200, await options.load());
    } catch (error) {
      if (error instanceof WorkspaceError) return reject(error.status, error.message);
      console.error(error);
      return reject(500, 'The request could not be completed. Refresh and try again.');
    }
  }

  const appDir = path.resolve(options.appDir);
  const file = path.resolve(appDir, '.' + (pathname === '/' ? '/index.html' : pathname));
  const info =
    file.startsWith(appDir + path.sep) && !file.includes('\0')
      ? await stat(file).catch(() => undefined)
      : undefined;
  if (!info?.isFile()) return reject(404, 'Not found.');
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

export function createDashboardServer(options: ServerOptions): Server {
  return createServer((request, response) => {
    handle(request, response, options).catch((error) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
}
