/** "Acme Product!" → "acme-product". Matches the contract's Slug pattern once it's 3+ chars. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** "TaskFlow API" → "TA", "Website" → "WEB". Matches ^[A-Z][A-Z0-9]{1,9}$ when the name has letters. */
export function suggestProjectKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z][A-Z0-9]*/g) ?? [];
  const first = words[0];
  if (!first) return '';
  if (words.length === 1) return first.slice(0, 3);
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 10);
}
