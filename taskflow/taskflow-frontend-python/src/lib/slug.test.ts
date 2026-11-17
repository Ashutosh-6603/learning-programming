import { describe, expect, it } from 'vitest';
import { slugify, suggestProjectKey } from './slug';

describe('slugify', () => {
  it('produces contract-valid slugs', () => {
    expect(slugify('Acme Product!')).toBe('acme-product');
    expect(slugify('  --Café  Ops-- ')).toBe('cafe-ops');
    expect(slugify('x'.repeat(50))).toHaveLength(40);
  });
});

describe('suggestProjectKey', () => {
  it('uses initials, or the first three letters of a single word', () => {
    expect(suggestProjectKey('TaskFlow API')).toBe('TA');
    expect(suggestProjectKey('Website')).toBe('WEB');
    expect(suggestProjectKey('2026 roadmap')).toBe('ROA');
    expect(suggestProjectKey('!!!')).toBe('');
  });
});
