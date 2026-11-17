import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './client-message.js';

const projectId = '01a18b7e-951f-71f4-affb-2b64a14174e2';

describe('parseClientMessage', () => {
  it('translates { type, payload } into the { event, data } Nest routes on', () => {
    const raw = JSON.stringify({ type: 'subscribe', payload: { projectId } });
    expect(parseClientMessage(raw)).toEqual({ event: 'subscribe', data: { projectId } });
    expect(parseClientMessage(Buffer.from('{"type":"ping"}'))).toEqual({ event: 'ping' });
  });

  it.each([
    'not json',
    '42',
    '{"type":"nonsense"}',
    '{"type":"subscribe"}',
    '{"type":"subscribe","payload":{"projectId":"nope"}}',
  ])('routes %s to the invalid handler', (raw) => {
    expect(parseClientMessage(raw)).toEqual({ event: 'invalid' });
  });
});
