import { http, HttpResponse, ws } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@/lib/api/types';
import { api, server } from '@/test/server';
import { ProjectSocket, type SocketStatus } from './project-socket';

const gateway = ws.link('ws://localhost:8004/ws');

let socket: ProjectSocket | undefined;
afterEach(() => {
  socket?.stop();
});

function start() {
  const statuses: SocketStatus[] = [];
  const messages: ServerMessage[] = [];
  socket = new ProjectSocket('p1', {
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
  });
  socket.start();
  return { statuses, messages };
}

describe('ProjectSocket', () => {
  it('gets a ticket, subscribes, and goes live on the ack', async () => {
    const urls: string[] = [];
    server.use(
      http.post(api('/ws/ticket'), () => HttpResponse.json({ ticket: 'T1', expiresAt: '' })),
      gateway.addEventListener('connection', ({ client }) => {
        urls.push(client.url.toString());
        client.addEventListener('message', (event) => {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            payload: { projectId: string };
          };
          if (msg.type === 'subscribe') {
            client.send(JSON.stringify({ type: 'subscribed', payload: msg.payload, ts: '' }));
          }
        });
      }),
    );

    const { statuses, messages } = start();
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe('live');
    });
    expect(urls).toEqual(['ws://localhost:8004/ws?ticket=T1']);
    expect(messages[0]).toMatchObject({ type: 'subscribed', payload: { projectId: 'p1' } });
  });

  it('reconnects with a fresh ticket after the server closes the socket', async () => {
    let tickets = 0;
    server.use(
      http.post(api('/ws/ticket'), () => {
        tickets += 1;
        return HttpResponse.json({ ticket: `T${tickets}`, expiresAt: '' });
      }),
      gateway.addEventListener('connection', ({ client }) => {
        if (tickets === 1) client.close(1001, 'server shutting down');
      }),
    );

    const { statuses } = start();
    await vi.waitFor(
      () => {
        expect(tickets).toBe(2);
      },
      { timeout: 3000 },
    );
    expect(statuses).toContain('reconnecting');
  });
});
