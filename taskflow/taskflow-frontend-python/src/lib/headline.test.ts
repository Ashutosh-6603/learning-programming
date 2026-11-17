import { describe, expect, it } from 'vitest';
import { parseHeadline } from './headline';

describe('parseHeadline', () => {
  it('splits marked and unmarked text', () => {
    expect(parseHeadline('fix the <mark>login</mark> flow')).toEqual([
      { text: 'fix the ', hit: false },
      { text: 'login', hit: true },
      { text: ' flow', hit: false },
    ]);
  });

  it('decodes the HTML entities the server escaped', () => {
    expect(parseHeadline('a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;')).toEqual([
      { text: `a <b> & "c" 'd'`, hit: false },
    ]);
  });

  it('never turns escaped markup back into a <mark>', () => {
    expect(parseHeadline('&lt;mark&gt;not a hit&lt;/mark&gt;')).toEqual([
      { text: '<mark>not a hit</mark>', hit: false },
    ]);
  });

  it('handles adjacent and leading marks', () => {
    expect(parseHeadline('<mark>a</mark><mark>b</mark>')).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: true },
    ]);
  });
});
