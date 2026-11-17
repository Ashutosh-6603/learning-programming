import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';
import { isProgressShape } from '../src/lib/progress-shape.ts';

const run = promisify(execFile);

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// Plugin middleware runs before Vite's own host check, and any website can send requests to
// localhost, so only requests from this page may read or write.
function isSameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

/** The commit subjects in a local repo, which is how the game verifies a step's commit. */
async function gitLog(folder: string) {
  const resolved = folder.startsWith('~') ? path.join(os.homedir(), folder.slice(1)) : folder;
  try {
    const { stdout } = await run('git', ['-C', resolved, 'log', '--format=%s', '-n', '5000']);
    return { ok: true as const, subjects: stdout.split('\n').filter(Boolean) };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    // A freshly `git init`-ed repo is valid: it just has nothing to verify yet.
    if (stderr.includes('does not have any commits')) return { ok: true as const, subjects: [] };
    return { ok: false as const, error: `No git repository found at ${resolved}` };
  }
}

/** Dev-server API: progress lives in a file, so clearing browser data can't erase months of work. */
export function ascentApi(dataDir: string): Plugin {
  const file = path.join(dataDir, 'progress.json');

  return {
    name: 'ascent-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        void (async () => {
          if (!isSameOrigin(req)) return send(res, 403, { error: 'forbidden' });
          const url = new URL(req.url ?? '/', 'http://localhost');

          if (url.pathname === '/progress' && req.method === 'GET') {
            const raw = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return 'null';
              throw error;
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(raw);
            return;
          }

          if (url.pathname === '/progress' && req.method === 'PUT') {
            const body = await readBody(req);
            const parsed: unknown = JSON.parse(body);
            if (!isProgressShape(parsed)) return send(res, 400, { error: 'not a valid progress save' });
            await mkdir(dataDir, { recursive: true });
            // Write-then-rename is atomic: a crash can't leave half a progress file behind.
            const temp = `${file}.tmp`;
            await writeFile(temp, JSON.stringify(parsed, null, 2));
            await copyFile(file, `${file}.bak`).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
            });
            await rename(temp, file);
            return send(res, 200, { ok: true });
          }

          if (url.pathname === '/git-log' && req.method === 'GET') {
            const folder = url.searchParams.get('path');
            if (!folder) return send(res, 400, { error: 'path is required' });
            return send(res, 200, await gitLog(folder));
          }

          next();
        })().catch((error: unknown) => send(res, 500, { error: String(error) }));
      });
    },
  };
}
