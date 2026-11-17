import { config } from '@/config';
import { realtimeApi } from '@/lib/api/endpoints';
import type { ServerMessage } from '@/lib/api/types';
import { backoffDelay } from './backoff';

export type SocketStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface Handlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

const PING_EVERY_MS = 25_000;

/**
 * One WebSocket subscribed to one project. Reconnects forever (with a fresh ticket each
 * time) until stop() is called. Uses the browser's plain WebSocket: no Socket.IO.
 */
export class ProjectSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private ping: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;

  private readonly projectId: string;
  private readonly handlers: Handlers;

  constructor(projectId: string, handlers: Handlers) {
    this.projectId = projectId;
    this.handlers = handlers;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.ping);
    clearTimeout(this.retry);
    this.ws?.close(1000, 'leaving board');
    this.ws = null;
    this.handlers.onStatus('closed');
  }

  private async connect(): Promise<void> {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      ticket = (await realtimeApi.ticket()).ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const ws = new WebSocket(`${config.wsUrl}/ws?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', payload: { projectId: this.projectId } }));
      this.ping = setInterval(() => {
        ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_EVERY_MS);
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'subscribed') {
        this.attempt = 0;
        this.handlers.onStatus('live');
      }
      this.handlers.onMessage(message);
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.handlers.onStatus('reconnecting');
    this.retry = setTimeout(() => void this.connect(), backoffDelay(this.attempt));
    this.attempt += 1;
  }
}
