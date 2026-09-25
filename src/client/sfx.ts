// Tiny synthesized sound effects (WebAudio, no asset files). Muted state persists per browser.

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("hyperdraft:muted") === "1";
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("hyperdraft:muted", m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function noise(a: AudioContext, duration: number, from: number, to: number, gain: number, when = 0) {
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.5;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  const t = a.currentTime + when;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

function tone(a: AudioContext, freq: number, when: number, duration: number, gain: number, type: OscillatorType = "sine") {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + when;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const sfx = {
  rip() {
    const a = audio();
    if (!a) return;
    noise(a, 0.45, 5200, 900, 0.5);
    noise(a, 0.2, 2500, 6000, 0.25, 0.08);
  },
  deal() {
    const a = audio();
    if (!a) return;
    noise(a, 0.06, 3000, 1500, 0.18);
  },
  flip() {
    const a = audio();
    if (!a) return;
    noise(a, 0.08, 1800, 4200, 0.16);
  },
  rare() {
    const a = audio();
    if (!a) return;
    [659, 880, 1319].forEach((f, i) => tone(a, f, i * 0.07, 0.6, 0.12, "triangle"));
  },
  mythic() {
    const a = audio();
    if (!a) return;
    [523, 659, 784, 1047, 1568].forEach((f, i) => tone(a, f, i * 0.06, 0.9, 0.11, "triangle"));
    tone(a, 130, 0, 0.8, 0.2, "sine");
  },
  select() {
    const a = audio();
    if (!a) return;
    tone(a, 1200, 0, 0.08, 0.06, "sine");
  },
  pick() {
    const a = audio();
    if (!a) return;
    noise(a, 0.25, 800, 4000, 0.3);
    tone(a, 988, 0.05, 0.25, 0.07, "triangle");
  },
  tick() {
    const a = audio();
    if (!a) return;
    tone(a, 1800, 0, 0.04, 0.05, "square");
  },
  tap() {
    const a = audio();
    if (!a) return;
    noise(a, 0.07, 1200, 600, 0.2);
  },
  /** Table ping: a soft two-note bell. Each seat gets its own pitch so you can tell who pinged. */
  ping(seat = 0) {
    const a = audio();
    if (!a) return;
    const root = 880 * [1, 9 / 8, 5 / 4, 3 / 2][seat % 4];
    [root, root * 1.5].forEach((f, i) => {
      tone(a, f, i * 0.11, 1.1, 0.09, "sine");
      // A quiet inharmonic partial gives it a bell-like shimmer.
      tone(a, f * 2.76, i * 0.11, 0.35, 0.018, "sine");
    });
  },
};
