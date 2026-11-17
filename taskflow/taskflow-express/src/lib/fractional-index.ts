// Fractional indexing (variable-length base62 keys), after David Greenspan's algorithm.
// A key is an "integer part" (a length-prefix head char + digits) followed by a fraction.
// Keys compare correctly with plain byte order, which is why the DB column is COLLATE "C".

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const INTEGER_ZERO = 'a0';
const SMALLEST_INTEGER = 'A' + '0'.repeat(26);

function digitAt(s: string, i: number): string {
  const c = s[i];
  if (c === undefined) throw new Error(`index ${i} out of range in "${s}"`);
  return c;
}

/** A fraction strictly between `a` and `b` (null = 1). Neither may end in '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.endsWith('0') || b?.endsWith('0')) throw new Error('trailing zero');
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(digitAt(a, 0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(digitAt(b, 0)) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(digitAt(key, 0));
  if (length > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.endsWith('0')) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const head = digitAt(x, 0);
  const digits = x.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '') + 1;
    if (d === DIGITS.length) {
      digits[i] = '0';
    } else {
      digits[i] = DIGITS.charAt(d);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(x: string): string | null {
  const head = digitAt(x, 0);
  const digits = x.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '') - 1;
    if (d === -1) {
      digits[i] = DIGITS.charAt(DIGITS.length - 1);
    } else {
      digits[i] = DIGITS.charAt(d);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + DIGITS.charAt(DIGITS.length - 1);
  if (head === 'A') return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < 'Z') digits.push(DIGITS.charAt(DIGITS.length - 1));
  else digits.pop();
  return prevHead + digits.join('');
}

/** A key strictly between `a` and `b`; `null` means "open end". */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return INTEGER_ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const decremented = decrementInteger(intB);
    if (decremented === null) throw new Error('cannot decrement any more');
    return decremented;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  if (b === null) {
    const incremented = incrementInteger(intA);
    return incremented ?? intA + midpoint(fracA, null);
  }

  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const incremented = incrementInteger(intA);
  if (incremented === null) throw new Error('cannot increment any more');
  if (incremented < b) return incremented;
  return intA + midpoint(fracA, null);
}
