import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WorkspaceError } from '../workspace/error.ts';
import type { Workspace } from '../workspace/model.ts';

export interface ServerOptions {
  /** Folder with the built dashboard. */
  appDir: string;
  /** Reads the workspace; called for every /workspace.json request. */
  load: () => Promise<Workspace>;
}
/** Why a request is turned away before it is routed. */
interface Refusal {
  status: number;
  error: string;
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

/** Writes the response to one request; a HEAD request gets the headers and no body. */
class Reply {
  private readonly request: IncomingMessage;
  private readonly response: ServerResponse;
  constructor(request: IncomingMessage, response: ServerResponse) {
    this.request = request;
    this.response = response;
  }

  json(status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    this.response.writeHead(status, {
      'Content-Type': contentTypes['.json'],
      'Content-Length': Buffer.byteLength(payload),
    });
    this.response.end(this.request.method === 'HEAD' ? undefined : payload);
  }

  error(status: number, message: string): void {
    this.json(status, { error: message });
  }

  file(file: string, size: number): void {
    this.response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': size,
    });
    if (this.request.method === 'HEAD') this.response.end();
    else createReadStream(file).pipe(this.response);
  }
}

function hostname(request: IncomingMessage): string {
  try {
    return new URL('http://' + request.headers.host).hostname;
  } catch {
    return '';
  }
}

/** The first admission rule the request breaks, or nothing when it may be routed. */
function refusal(request: IncomingMessage): Refusal | undefined {
  // The host check stops DNS rebinding; the next two stop other sites reading local files.
  if (!['localhost', '127.0.0.1'].includes(hostname(request)))
    return { status: 403, error: 'Local access only.' };
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== 'http://' + request.headers.host)
    return { status: 403, error: 'Cross-origin access is disabled.' };
  if (request.headers['sec-fetch-site'] === 'cross-site')
    return { status: 403, error: 'Cross-site access is disabled.' };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return { status: 405, error: 'This dashboard is read-only.' };
  return undefined;
}

/** The decoded path of the request, or nothing when the address cannot be decoded. */
function pathnameOf(request: IncomingMessage): string | undefined {
  try {
    return decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    return undefined;
  }
}

/** Sends the workspace; a WorkspaceError is its status and message, anything else a 500. */
async function serveWorkspace(options: ServerOptions, reply: Reply): Promise<void> {
  try {
    reply.json(200, await options.load());
  } catch (error) {
    if (error instanceof WorkspaceError) return reply.error(error.status, error.message);
    console.error(error);
    reply.error(500, 'The request could not be completed. Refresh and try again.');
  }
}

/** Sends a file of the built dashboard, `/` being its page; anything else is not found. */
async function serveFile(options: ServerOptions, pathname: string, reply: Reply): Promise<void> {
  const appDir = path.resolve(options.appDir);
  const file = path.resolve(appDir, '.' + (pathname === '/' ? '/index.html' : pathname));
  const inside = file.startsWith(appDir + path.sep) && !file.includes('\0');
  const info = inside ? await stat(file).catch(() => undefined) : undefined;
  if (!info?.isFile()) return reply.error(404, 'Not found.');
  reply.file(file, info.size);
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
  const reply = new Reply(request, response);
  const refused = refusal(request);
  if (refused) return reply.error(refused.status, refused.error);
  const pathname = pathnameOf(request);
  if (pathname === undefined) return reply.error(400, 'Malformed address.');
  if (pathname === '/workspace.json') return serveWorkspace(options, reply);
  return serveFile(options, pathname, reply);
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
