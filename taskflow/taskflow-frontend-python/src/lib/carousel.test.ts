import { describe, expect, it } from 'vitest';
import { panelAt, ringRadius, ringTransform, rotateTo, shortestStep, step, wrap } from './carousel';

describe('wrap', () => {
  it('maps negatives into range', () => {
    expect(wrap(-1, 5)).toBe(4);
    expect(wrap(-6, 5)).toBe(4);
    expect(wrap(7, 5)).toBe(2);
  });
});

describe('shortestStep', () => {
  it('goes the short way round', () => {
    expect(shortestStep(0, 1, 5)).toBe(1);
    expect(shortestStep(0, 4, 5)).toBe(-1);
    expect(shortestStep(4, 0, 5)).toBe(1);
    expect(shortestStep(2, 2, 5)).toBe(0);
  });
});

describe('a full ring (5+ panels)', () => {
  it('keeps counting past the end so it never spins back', () => {
    expect(step(4, 1, 5)).toBe(5);
    expect(rotateTo(5, 4, 5)).toBe(4);
    expect(rotateTo(4, 0, 5)).toBe(5);
  });

  it('puts the panel matching the rotation in front, even after many spins', () => {
    expect(panelAt(2, 12, 5, 400).front).toBe(true);
    expect(panelAt(2, -3, 5, 400).front).toBe(true);
  });

  it('fades panels by their distance from the front', () => {
    expect(panelAt(1, 0, 5, 400).opacity).toBe(0.55);
    expect(panelAt(4, 0, 5, 400).opacity).toBe(0.55);
    expect(panelAt(2, 0, 5, 400).opacity).toBe(0.2);
  });
});

describe('a partial ring (fewer than 5 panels)', () => {
  it('spaces panels as if there were 5, so neighbours stay visible', () => {
    expect(panelAt(1, 0, 3, 400).transform).toBe('rotateY(72deg) translateZ(400px)');
    expect(ringTransform(2, 3, 400)).toBe('translateZ(-400px) rotateY(-144deg)');
  });

  it('wraps at the ends and measures distance along the arc', () => {
    expect(step(2, 1, 3)).toBe(0);
    expect(step(0, -1, 3)).toBe(2);
    expect(panelAt(2, 0, 3, 400).opacity).toBe(0.2);
    expect(rotateTo(0, 2, 3)).toBe(2);
  });
});

describe('ringRadius', () => {
  it('grows with the number of slots', () => {
    expect(ringRadius(3, 300)).toBe(ringRadius(5, 300));
    expect(ringRadius(8, 300)).toBeGreaterThan(ringRadius(5, 300));
  });
});
