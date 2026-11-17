import type { RawData } from 'ws';
import { UUID } from '../../common/validation/parse-id.pipe.js';

/** What Nest's WsAdapter routes on: `event` picks the @SubscribeMessage handler, `data` is its argument. */
export interface RoutedMessage {
  event: 'subscribe' | 'unsubscribe' | 'ping' | 'invalid';
  data: { projectId: string } | undefined;
}

const INVALID: RoutedMessage = { event: 'invalid', data: undefined };

function rawToString(data: RawData | string): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/**
 * Nest expects `{ event, data }` frames; our protocol is `{ type, payload }`. This parser
 * translates, and validates while it's at it: anything malformed is routed to the "invalid"
 * handler instead of being dropped silently.
 */
export function parseClientMessage(raw: RawData | string): RoutedMessage {
  let message: unknown;
  try {
    message = JSON.parse(rawToString(raw));
  } catch {
    return INVALID;
  }
  if (typeof message !== 'object' || message === null) return INVALID;
  const { type, payload } = message as { type?: unknown; payload?: unknown };
  if (type === 'ping') return { event: 'ping', data: undefined };
  if (type !== 'subscribe' && type !== 'unsubscribe') return INVALID;
  if (typeof payload !== 'object' || payload === null) return INVALID;
  const { projectId } = payload as { projectId?: unknown };
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return INVALID;
  return { event: type, data: { projectId } };
}
