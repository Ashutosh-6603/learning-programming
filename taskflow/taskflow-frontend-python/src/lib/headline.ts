export interface HeadlinePart {
  text: string;
  hit: boolean;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (e) => ENTITIES[e] ?? e);

/**
 * Turns the server's `ts_headline` snippet ("fix <mark>login</mark> &amp; …") into plain parts.
 * React renders each part as a text node, so nothing from the server is ever parsed as HTML:
 * no dangerouslySetInnerHTML, no XSS even if escaping on the server were wrong.
 */
export function parseHeadline(headline: string): HeadlinePart[] {
  const parts: HeadlinePart[] = [];
  let hit = false;
  for (const token of headline.split(/(<mark>|<\/mark>)/)) {
    if (token === '<mark>') hit = true;
    else if (token === '</mark>') hit = false;
    else if (token) parts.push({ text: decode(token), hit });
  }
  return parts;
}
