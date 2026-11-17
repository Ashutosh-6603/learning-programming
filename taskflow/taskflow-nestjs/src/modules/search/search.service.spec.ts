import { describe, expect, it } from 'vitest';
import { toSafeHeadline } from './search.service.js';

describe('toSafeHeadline', () => {
  it('escapes HTML but keeps match markers as <mark>', () => {
    const raw = '<script>alert(1)</script> fix \u0001login\u0002 & "logout"';
    expect(toSafeHeadline(raw)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; fix <mark>login</mark> &amp; &quot;logout&quot;',
    );
  });
});
