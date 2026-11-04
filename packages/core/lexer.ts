export const MAX_LENGTH = 1024 * 1024;
export interface Token {
  kind: 'identifier' | 'string' | 'comment' | 'punctuation' | 'number' | 'operator';
  start: number;
  end: number;
  text: string;
  closed: boolean;
}

/** Preserve UTF-16 locations; literals and comments are opaque to later parsing. */
export function scan(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i, c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    let kind: Token['kind'] = 'punctuation', closed = true;
    if (text.startsWith('//', i)) {
      kind = 'comment'; i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (text.startsWith('/*', i)) {
      kind = 'comment'; const end = text.indexOf('*/', i + 2);
      closed = end !== -1; i = closed ? end + 2 : text.length;
    } else if (c === '"' || c === "'") {
      kind = 'string';
      const delimiter = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      i += delimiter.length; closed = false;
      while (i < text.length) {
        if (text[i] === '\\') { i = Math.min(i + 2, text.length); continue; }
        if (text.startsWith(delimiter, i)) { i += delimiter.length; closed = true; break; }
        i++;
      }
    } else if (/[A-Za-z_]/.test(c)) {
      kind = 'identifier'; i++;
      while (i < text.length && /[A-Za-z_0-9]/.test(text[i]!)) i++;
    } else if (/[0-9]/.test(c)) {
      kind = 'number';
      i += text.slice(i).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)![0].length;
    } else {
      const operator = ['!~=', '->', '!=', '>=', '<=', '~=', '=='].find(op => text.startsWith(op, i));
      if (operator) { kind = 'operator'; i += operator.length; }
      else { if ('=<>+-*/%'.includes(c)) kind = 'operator'; i++; }
    }
    tokens.push({ kind, start, end: i, text: text.slice(start, i), closed });
  }
  return tokens;
}

export function insideLiteral(tokens: Token[], offset: number): boolean {
  return tokens.some(t => (t.kind === 'string' || t.kind === 'comment') && offset > t.start &&
    (offset < t.end || (!t.closed && offset <= t.end) ||
      (t.kind === 'comment' && t.text.startsWith('//') && offset === t.end)));
}
