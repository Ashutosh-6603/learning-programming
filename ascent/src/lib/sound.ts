/** Synthesised, so there are no audio files, and every cue sits in one key and sounds related. */
let context: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

function ctx(): AudioContext {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'triangle') {
  const audio = ctx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const at = audio.currentTime + start;
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

// A major pentatonic scale: any sequence of these notes sounds pleasant together.
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0];
const note = (index: number) => {
  const octave = Math.floor(index / SCALE.length);
  return (SCALE[index % SCALE.length] as number) * 2 ** octave;
};

function play(cue: () => void) {
  if (!enabled) return;
  try {
    cue();
  } catch {
    // Audio is a garnish: never let it break a tick.
  }
}

export const sound = {
  /** Each tick in a step climbs one note higher, so finishing a step is audibly going up. */
  tick: (index: number) =>
    play(() => {
      tone(note(index + 5), 0, 0.16, 0.14);
      tone(note(index + 10), 0, 0.09, 0.04, 'sine');
    }),
  untick: () => play(() => tone(196, 0, 0.1, 0.06, 'sine')),
  note: () =>
    play(() => {
      [9, 11, 12, 14].forEach((n, i) => tone(note(n), i * 0.05, 0.3, 0.08, 'sine'));
    }),
  verified: () =>
    play(() => {
      tone(note(10), 0, 0.12, 0.1);
      tone(note(13), 0.08, 0.28, 0.12);
    }),
  step: () =>
    play(() => {
      [5, 7, 8, 10].forEach((n, i) => tone(note(n), i * 0.07, 0.5, 0.12));
    }),
  camp: () =>
    play(() => {
      tone(70, 0, 0.3, 0.45, 'sine');
      tone(140, 0, 0.12, 0.2, 'square');
      [5, 7, 8, 10, 12].forEach((n, i) => tone(note(n), 0.25 + i * 0.09, 0.7, 0.12));
    }),
  summit: () =>
    play(() => {
      tone(65, 0, 0.5, 0.45, 'sine');
      [0, 2, 3, 5, 7, 8, 10, 12, 13, 15].forEach((n, i) => tone(note(n), 0.15 + i * 0.1, 1.1, 0.1));
      [10, 12, 13, 15].forEach((n) => tone(note(n), 1.3, 2, 0.08, 'sine'));
    }),
  patch: () =>
    play(() => {
      tone(note(12), 0, 0.2, 0.1, 'sine');
      tone(note(15), 0.1, 0.45, 0.1, 'sine');
    }),
  rank: () =>
    play(() => {
      [8, 10, 12, 15].forEach((n, i) => tone(note(n), i * 0.12, 0.6, 0.1));
    }),
};
