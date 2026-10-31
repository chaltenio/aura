#!/usr/bin/env node
// promo/sfx.mjs: the app's own sounds as WAV files for the edit (headless phones play them into nothing).
//   node promo/sfx.mjs <out dir>  ->  shriek.wav (web/common.js shriek(), same envelope), shutter.wav, pop.wav
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2]; if (!out) { console.error('usage: node promo/sfx.mjs <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const SR = 48000;
function wav(path, samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  writeFileSync(path, b);
}
// exponential ramp between (t0, v0) and (t1, v1), as WebAudio's exponentialRampToValueAtTime
const expRamp = (t, t0, v0, t1, v1) => v0 * Math.pow(v1 / v0, Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));

// shriek: sawtooth 220 -> 1400 Hz (0.25 s) -> 180 Hz (1.1 s), gain 0 -> 0.6 (0.05 s) -> 0 (1.2 s), plus a decaying noise burst from 0.1 s
{
  const n = Math.round(SR * 1.3), s = new Float64Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = t < 0.25 ? expRamp(t, 0, 220, 0.25, 1400) : expRamp(t, 0.25, 1400, 1.1, 180);
    const g = t < 0.05 ? expRamp(t, 0, 0.0001, 0.05, 0.6) : expRamp(t, 0.05, 0.6, 1.2, 0.0001);
    ph = (ph + f / SR) % 1;
    let v = t < 1.25 ? (2 * ph - 1) * g : 0;
    if (t >= 0.1 && t < 0.7) v += (Math.random() * 2 - 1) * (1 - (t - 0.1) / 0.6) * 0.25;
    s[i] = v * 0.8;
  }
  wav(join(out, 'shriek.wav'), s);
}
// shutter: two short filtered clicks
{
  const n = Math.round(SR * 0.18), s = new Float64Array(n); let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.exp(-t * 60) + (t > 0.07 ? 0.6 * Math.exp(-(t - 0.07) * 70) : 0);
    lp += 0.35 * ((Math.random() * 2 - 1) - lp); s[i] = lp * env * 0.9;
  }
  wav(join(out, 'shutter.wav'), s);
}
// pop: a soft rising blip for a card appearing
{
  const n = Math.round(SR * 0.22), s = new Float64Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 520 + 900 * Math.min(1, t / 0.06);
    ph += (2 * Math.PI * f) / SR; s[i] = Math.sin(ph) * Math.exp(-t * 18) * 0.5 * Math.min(1, t / 0.004);
  }
  wav(join(out, 'pop.wav'), s);
}
console.log(`wrote shriek.wav, shutter.wav, pop.wav to ${out}`);
