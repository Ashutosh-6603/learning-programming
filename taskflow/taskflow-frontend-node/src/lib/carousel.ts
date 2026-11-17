/** Wraps any integer into 0..n-1 (JS `%` keeps the sign, so -1 % 5 is -1, not 4). */
export const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Fewer panels than this still get this many slots on the ring. With 3 panels at 120° apart,
 * the neighbours would face away from the viewer and `backface-visibility: hidden` hides them.
 */
export const MIN_SLOTS = 5;

/** A full ring spins forever in one direction; a partial one has two ends. */
const isFullRing = (n: number) => n >= MIN_SLOTS;

/**
 * The signed number of steps from `from` to `to` around a ring of n, taking the short way:
 * on a ring of 5, going from 0 to 4 is -1, not +4.
 */
export function shortestStep(from: number, to: number, n: number): number {
  const delta = wrap(to - from, n);
  return delta > n / 2 ? delta - n : delta;
}

/** The rotation that brings panel i to the front, starting from `rotation`. */
export function rotateTo(rotation: number, i: number, n: number): number {
  return isFullRing(n) ? rotation + shortestStep(wrap(rotation, n), i, n) : i;
}

/**
 * The next rotation after a step of ±1. A full ring keeps counting (so it never snaps back
 * at the wrap point); a partial ring wraps, which spins it back to the other end.
 */
export function step(rotation: number, direction: -1 | 1, n: number): number {
  return isFullRing(n) ? rotation + direction : wrap(rotation + direction, n);
}

export interface Panel {
  transform: string;
  opacity: number;
  filter: string;
  front: boolean;
}

/** Where panel i sits on the 3D ring when the ring is at `rotation`. */
export function panelAt(i: number, rotation: number, n: number, radius: number): Panel {
  const slots = Math.max(n, MIN_SLOTS);
  const rel = wrap(i - rotation, n);
  const distance = isFullRing(n) ? Math.min(rel, n - rel) : Math.abs(i - wrap(rotation, n));
  const front = distance === 0;
  return {
    transform: `rotateY(${(i * 360) / slots}deg) translateZ(${radius}px)`,
    opacity: front ? 1 : distance === 1 ? 0.55 : 0.2,
    filter: front ? 'none' : `blur(${distance}px) saturate(.6)`,
    front,
  };
}

export function ringTransform(rotation: number, n: number, radius: number): string {
  const slots = Math.max(n, MIN_SLOTS);
  const angle = (-(isFullRing(n) ? rotation : wrap(rotation, n)) * 360) / slots;
  return `translateZ(-${radius}px) rotateY(${angle}deg)`;
}

/** Wide enough that neighbouring panels don't intersect: r = (w/2) / tan(π/slots). */
export function ringRadius(n: number, panelWidth: number): number {
  const slots = Math.max(n, MIN_SLOTS);
  return Math.min(900, Math.round(panelWidth / 2 / Math.tan(Math.PI / slots)) + 120);
}
