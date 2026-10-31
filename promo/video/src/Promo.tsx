// HAUNT promo: the recorded simulated runs (promo/sim.mjs) cut into one ~70 s film.
// Every scene is placed on the recordings by wall-clock marks, so a re-run of the sim re-times the cut by itself.
import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import qrcode from 'qrcode-generator';

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600', '700', '800', '900'], subsets: ['latin'] });

export type Marks = Record<string, number>;
const FPS = 30;
const fr = (sec: number) => Math.round(sec * FPS);
const XF = 10; // crossfade between scenes, frames
const C = { bg: '#0b0a10', panel: '#16141f', ink: '#ece7f5', mute: '#a8a1bd', accent: '#ff6a00', ok: '#7CFF6B', glow: '#b14cff', glowSoft: '#cf9bff' };
const LIVE = 'aura-haunt.base44.app'; // the Base44 mirror (same pages, Fly API behind it); the QR and the URL on the end card
const CAST = [
  { id: 'priya', title: "Priya O'Lantern" }, { id: 'theo', title: 'Count Theo' }, { id: 'nadia', title: 'Nadia the Witch' },
  { id: 'kenji', title: 'Kenji Mori' }, { id: 'amara', title: 'Amara, Demon of Prod' }, { id: 'lucas', title: 'Lucas Bones' },
  { id: 'sofia', title: 'The Ghost of Sofia' },
];

// ---------- building blocks ----------
const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const x = 38 + 10 * Math.sin(f / 95), y = 42 + 8 * Math.cos(f / 120);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(1100px 760px at ${x}% ${y}%, rgba(122,46,190,.42) 0%, rgba(11,10,16,0) 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(900px 620px at ${100 - x * 0.6}% ${92 - y * 0.5}%, rgba(255,106,0,.13) 0%, rgba(11,10,16,0) 70%)` }} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)' }} />
    </AbsoluteFill>
  );
};

/** Fade a scene in and out over XF frames so neighbours crossfade. */
const SceneFade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, XF, dur - XF, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const SW = 410, SH = Math.round(SW * 2556 / 1179), BZ = 12; // phone screen and bezel, px
const Phone: React.FC<{ cx: number; label?: string; shakeAt?: number[]; children: React.ReactNode; enter?: boolean }> = ({ cx, label, shakeAt = [], children, enter = true }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const inn = enter ? spring({ frame: f, fps, config: { damping: 18, stiffness: 120 } }) : 1;
  let dx = 0;
  for (const s of shakeAt) { const k = f - s; if (k >= 0 && k < 20) dx += 9 * Math.sin(k * 2.6) * (1 - k / 20); } // the phone buzzes
  const w = SW + 2 * BZ, h = SH + 2 * BZ;
  return (
    <div style={{ position: 'absolute', left: cx - w / 2 + dx, top: (1080 - h) / 2 + 12 + (1 - inn) * 120, width: w, height: h, opacity: inn }}>
      {label && <div style={{ position: 'absolute', top: -46, left: 0, right: 0, textAlign: 'center' }}>
        <span style={{ fontFamily, fontWeight: 700, fontSize: 19, letterSpacing: 3, textTransform: 'uppercase', color: C.glowSoft, background: 'rgba(177,76,255,.14)', border: '1px solid rgba(177,76,255,.35)', padding: '6px 14px', borderRadius: 999 }}>{label}</span>
      </div>}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 66, background: 'linear-gradient(150deg,#34303f 0%,#15141b 45%,#0d0c12 100%)', boxShadow: '0 60px 120px rgba(0,0,0,.7), 0 0 0 1.5px #4a4459, 0 0 90px rgba(177,76,255,.20)' }} />
      <div style={{ position: 'absolute', left: BZ, top: BZ, width: SW, height: SH, borderRadius: 54, overflow: 'hidden', background: '#000' }}>
        {children}
        <div style={{ position: 'absolute', top: 7, left: '50%', marginLeft: -7, width: 14, height: 14, borderRadius: 7, background: '#000', boxShadow: '0 0 0 2px rgba(0,0,0,.35)' }} />
      </div>
    </div>
  );
};
const Screen: React.FC<{ src: string; trim: number; rate?: number }> = ({ src, trim, rate = 1 }) => (
  <OffthreadVideo src={staticFile(src)} trimBefore={trim} playbackRate={rate} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
);

/** Text with *accent* phrases. */
const rich = (s: string) => s.split(/(\*[^*]+\*)/).map((p, i) => p.startsWith('*') ? <span key={i} style={{ color: C.accent }}>{p.slice(1, -1)}</span> : <React.Fragment key={i}>{p}</React.Fragment>);
/** The same markup as words, each knowing whether it sits inside an accent, for word-by-word animation. */
const accentWords = (s: string) => s.split(/(\*[^*]+\*)/).filter(Boolean).flatMap((p) => {
  const accent = p.startsWith('*') && p.endsWith('*');
  return (accent ? p.slice(1, -1) : p).split(' ').filter(Boolean).map((w) => ({ w, accent }));
});

type Cap = { at: number; title: string; sub?: string };
/** Right-hand captions: the kicker stays, each caption replaces the last with a quick rise. */
const Captions: React.FC<{ kicker: string; caps: Cap[]; left: number; width: number; size?: number }> = ({ kicker, caps, left, width, size = 74 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const k = spring({ frame: f - 2, fps, config: { damping: 20 } });
  const idx = caps.reduce((m, c, i) => (f >= c.at ? i : m), -1);
  return (
    <div style={{ position: 'absolute', left, width, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', fontFamily }}>
      <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', color: C.glowSoft, opacity: k, transform: `translateY(${(1 - k) * 14}px)`, marginBottom: 22 }}>{kicker}</div>
      <div style={{ position: 'relative', minHeight: size * 2.2 + 150 }}>
        {caps.map((c, i) => {
          if (i !== idx && i !== idx - 1) return null;
          const local = f - c.at;
          const next = caps[i + 1]?.at;
          const out = next === undefined ? 1 : interpolate(f, [next, next + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const words = accentWords(c.title);
          return (
            <div key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: out, transform: `translateY(${(1 - out) * -20}px)` }}>
              <div style={{ fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: -2.2, color: C.ink }}>
                {words.map(({ w, accent }, j) => {
                  const s = spring({ frame: local - j * 2.5, fps, config: { damping: 16, stiffness: 150 } });
                  return <span key={j} style={{ display: 'inline-block', marginRight: size * 0.24, color: accent ? C.accent : undefined, opacity: s, transform: `translateY(${(1 - s) * 34}px)`, filter: `blur(${(1 - s) * 6}px)` }}>{w}</span>;
                })}
              </div>
              {c.sub && <div style={{ marginTop: 24, fontWeight: 500, fontSize: 30, lineHeight: 1.32, color: C.mute, opacity: interpolate(local, [6, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), maxWidth: width - 20 }}>{rich(c.sub)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Sfx: React.FC<{ at: number; src: string; volume?: number }> = ({ at, src, volume = 0.7 }) => (
  at >= 0 ? <Sequence from={at} durationInFrames={60} layout="none"><Audio src={staticFile(src)} volume={volume} /></Sequence> : null
);

const Logo: React.FC<{ size: number; glow?: number }> = ({ size, glow = 1 }) => (
  <div style={{ fontFamily, fontWeight: 900, fontSize: size, letterSpacing: -size * 0.03, color: C.ink, display: 'flex', alignItems: 'center', gap: size * 0.22, textShadow: `0 0 ${40 * glow}px rgba(177,76,255,.75), 0 0 ${110 * glow}px rgba(177,76,255,.45)` }}>
    <span style={{ fontSize: size * 0.92, filter: `drop-shadow(0 0 ${26 * glow}px rgba(177,76,255,.9))` }}>👻</span>HAUNT
  </div>
);

const Portraits: React.FC<{ named: boolean; h: number; drift: number; dim: number }> = ({ named, h, drift, dim }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const w = Math.round(h * 0.778), gap = Math.round(h * (named ? 0.3 : 0.085)); // named: room for two-line costume titles
  const total = CAST.length * w + (CAST.length - 1) * gap;
  return (
    <div style={{ position: 'absolute', left: (1920 - total) / 2 - f * drift, top: 0, display: 'flex', gap }}>
      {CAST.map((c, i) => {
        const s = spring({ frame: f - i * 3, fps, config: { damping: 20 } });
        return (
          <div key={c.id} style={{ width: w, opacity: s, transform: `translateY(${(1 - s) * 40}px)` }}>
            <Img src={staticFile(`${c.id}.png`)} style={{ width: w, height: h, objectFit: 'cover', borderRadius: h * 0.06, filter: `brightness(${dim}) saturate(${named ? 1 : 0.55})`, boxShadow: '0 20px 60px rgba(0,0,0,.6)' }} />
            <div style={{ marginTop: h * 0.06, marginLeft: -gap / 2, marginRight: -gap / 2, textAlign: 'center', fontFamily, fontWeight: 700, fontSize: Math.max(19, h * 0.085), lineHeight: 1.2, color: named ? C.ink : C.mute, letterSpacing: named ? -0.3 : 4 }}>{named ? c.title : '? ? ?'}</div>
          </div>
        );
      })}
    </div>
  );
};

const QR: React.FC<{ text: string; size: number }> = ({ text, size }) => {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = size / (n + 4);
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) rects.push(<rect key={`${r}-${c}`} x={(c + 2) * cell} y={(r + 2) * cell} width={cell + 0.4} height={cell + 0.4} fill="#0b0a10" />);
  return <svg width={size} height={size} style={{ background: '#fff', borderRadius: 18 }}>{rects}</svg>;
};

// ---------- scenes ----------
type Scene = { key: string; dur: number; el: React.ReactNode };

function plan(m: Marks): Scene[] {
  const T = (label: string) => m[label];
  const has = (...labels: string[]) => labels.every((l) => typeof m[l] === 'number');
  const st = (rec: string) => m[`${rec}:start`];
  const trim = (rec: string, w: number) => Math.max(0, fr(w - st(rec))); // source frames to skip so the clip starts at wall time w
  const scenes: Scene[] = [];

  // 0. hook: a room of strangers
  {
    const dur = fr(7.2);
    const lines = [{ at: 6, text: 'A room full of builders.' }, { at: 66, text: 'You know *none* of their names.' }];
    scenes.push({ key: 'hook', dur, el: <Hook lines={lines} logoAt={124} /> });
  }

  // 1. sign up: the onboarding run, fast-forwarded through the typing, near real time for the selfies
  if (has('onboard-priya:start', 'onboard:camera', 'onboard:me')) {
    const rec = 'onboard-priya.mp4', r = 'onboard-priya';
    const a0 = T('onboard:ready') + 0.8, a1 = T('onboard:camera') - 0.3, b1 = T('onboard:me') + 2.4;
    const rateA = 2.1, rateB = 1.3, durA = fr((a1 - a0) / rateA), durB = fr((b1 - a1) / rateB);
    const at = (w: number) => (w < a1 ? fr((w - a0) / rateA) : durA + fr((w - a1) / rateB));
    const caps: Cap[] = [
      { at: 4, title: 'Scan the QR. *No app.*', sub: 'Name, GitHub, one line about what you are building.' },
      { at: at(T('onboard:costume')) - 6, title: 'Pick a *costume.*', sub: 'Phones that find you draw it on your face.' },
      { at: at(T('onboard:camera')) - 4, title: 'Three *selfies.*', sub: 'They stay on your phone. Only a face signature and a card thumbnail are uploaded.' },
      { at: at(T('onboard:submit')) - 14, title: 'Tick consent. *You’re findable.*', sub: 'Opt-in only, and you can switch it off any time.' },
    ];
    scenes.push({ key: 'signup', dur: durA + durB, el: (
      <>
        <Phone cx={560}>
          <Sequence durationInFrames={durA} layout="none"><Screen src={rec} trim={trim(r, a0)} rate={rateA} /></Sequence>
          <Sequence from={durA} layout="none"><Screen src={rec} trim={trim(r, a1)} rate={rateB} /></Sequence>
        </Phone>
        <Captions kicker="01 · Sign up in a minute" caps={caps} left={950} width={860} />
        {['onboard:selfie1', 'onboard:selfie2', 'onboard:selfie3'].filter((l) => has(l)).map((l) => <Sfx key={l} at={at(T(l)) - 2} src="shutter.wav" volume={0.5} />)}
        <Sfx at={at(T('onboard:me'))} src="pop.wav" volume={0.45} />
      </>
    ) });
  }

  // 2. hunt: point the phone at Theo, his card and his vampire appear
  if (has('hunt-priya:start', 'hunt:card', 'hunt:haunt')) {
    const w0 = T('hunt:ready') + 0.7, w1 = T('hunt:haunt') - 0.45;
    const at = (w: number) => fr(w - w0);
    const caps: Cap[] = [
      { at: 4, title: 'Point your phone at *someone.*' },
      { at: at(T('hunt:card')) - 2, title: 'Know *who* they are.', sub: 'The match runs on the phone: a face detector, landmarks and a 512-number signature.' },
    ];
    scenes.push({ key: 'hunt', dur: fr(w1 - w0), el: (
      <>
        <Phone cx={560}><Screen src="hunt-priya.mp4" trim={trim('hunt-priya', w0)} /></Phone>
        <Captions kicker="02 · Hunt" caps={caps} left={950} width={860} />
        <Sfx at={at(T('hunt:card'))} src="pop.wav" volume={0.5} />
      </>
    ) });
  }

  // 3. haunt: both phones, the shriek, the haunt back
  if (has('hunt-theo:start', 'hunt:haunted', 'hunt:backed')) {
    const w0 = T('hunt:haunt') - 1.15, w1 = T('hunt:backed') + 2.5;
    const at = (w: number) => fr(w - w0);
    const caps: Cap[] = [
      { at: 4, title: '*Haunt* them.' },
      { at: at(T('hunt:haunted')) - 2, title: 'Their phone *shrieks.*', sub: 'Sound, a flash and a buzz, with who found them.' },
      { at: at(T('hunt:back')) - 4, title: 'They haunt you *back.*', sub: 'Now you both have each other’s card.' },
    ];
    scenes.push({ key: 'haunt', dur: fr(w1 - w0), el: (
      <>
        <Phone cx={380} label="Priya" shakeAt={[at(T('hunt:backed'))]}><Screen src="hunt-priya.mp4" trim={trim('hunt-priya', w0)} /></Phone>
        <Phone cx={880} label="Theo" shakeAt={[at(T('hunt:haunted'))]}><Screen src="hunt-theo.mp4" trim={trim('hunt-theo', w0)} /></Phone>
        <Captions kicker="03 · Haunt" caps={caps} left={1190} width={660} size={66} />
        <Sfx at={at(T('hunt:haunted'))} src="shriek.wav" volume={0.55} />
        <Sfx at={at(T('hunt:backed'))} src="shriek.wav" volume={0.42} />
      </>
    ) });
  }

  // 4. the big screen
  if (has('hunt-screen:start', 'hunt-screen:end')) {
    const w0 = T('hunt:haunt') - 0.9, w1 = Math.min(T('hunt-screen:end') - 0.1, w0 + 7.2);
    scenes.push({ key: 'screen', dur: fr(w1 - w0), el: <ScreenScene trim={trim('hunt-screen', w0)} /> });
  }

  // 5. a stranger: never named
  if (has('stranger-priya:start', 'stranger:unknown')) {
    const w0 = T('stranger:unknown') - 0.9, w1 = Math.min(T('stranger-priya:end') - 0.05, w0 + 4.8);
    const caps: Cap[] = [{ at: 4, title: 'Strangers stay *strangers.*', sub: 'Not registered? Never named, never stored. Just “unknown”.' }];
    scenes.push({ key: 'stranger', dur: fr(w1 - w0), el: (
      <>
        <Phone cx={560}><Screen src="stranger-priya.mp4" trim={trim('stranger-priya', w0)} /></Phone>
        <Captions kicker="05 · Privacy first" caps={caps} left={950} width={860} />
      </>
    ) });
  }

  // 6. kill switch: Nadia unticks Findable and Priya's phone stops naming her
  if (has('vanish-priya:start', 'vanish-nadia:start', 'vanish:off', 'vanish:unknown')) {
    const w0 = T('vanish:card') + 0.35, w1 = Math.min(T('vanish:unknown') + 2.7, T('vanish-priya:end') - 0.05, T('vanish-nadia:end') - 0.05);
    const at = (w: number) => fr(w - w0);
    const caps: Cap[] = [
      { at: 4, title: 'Consent you can *take back.*', sub: 'Priya found Nadia. Nadia has had enough.' },
      { at: at(T('vanish:off')) - 3, title: 'One tap. *Gone* from every phone.', sub: 'Findable off: phones stop naming her at once.' },
    ];
    scenes.push({ key: 'vanish', dur: fr(w1 - w0), el: (
      <>
        <Phone cx={380} label="Priya"><Screen src="vanish-priya.mp4" trim={trim('vanish-priya', w0)} /></Phone>
        <Phone cx={880} label="Nadia"><Screen src="vanish-nadia.mp4" trim={trim('vanish-nadia', w0)} /></Phone>
        <Captions kicker="05 · Privacy first" caps={caps} left={1190} width={660} size={66} />
      </>
    ) });
  }

  // 7. afterwards: tonight's connections
  if (has('connections-priya:start', 'connections-priya:end')) {
    const w0 = T('connections-priya:start') + 0.2, w1 = T('connections-priya:end') - 0.05;
    const caps: Cap[] = [{ at: 4, title: 'Leave with *everyone* you met.', sub: 'Who you found and who found you, with GitHub and LinkedIn. One tap to copy.' }];
    scenes.push({ key: 'connections', dur: fr(w1 - w0), el: (
      <>
        <Phone cx={560}><Screen src="connections-priya.mp4" trim={trim('connections-priya', w0)} /></Phone>
        <Captions kicker="06 · Afterwards" caps={caps} left={950} width={860} />
      </>
    ) });
  }

  scenes.push({ key: 'how', dur: fr(5.6), el: <How /> });
  scenes.push({ key: 'end', dur: fr(7.5), el: <EndCard /> });
  return scenes;
}

export const totalFrames = (m: Marks) => {
  const s = plan(m);
  return s.reduce((n, x) => n + x.dur, 0) - XF * (s.length - 1);
};

// ---------- text-only scenes ----------
const Hook: React.FC<{ lines: { at: number; text: string }[]; logoAt: number }> = ({ lines, logoAt }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const logo = spring({ frame: f - logoAt, fps, config: { damping: 14, stiffness: 90 } });
  const roomDim = interpolate(f, [0, 20, logoAt - 10, logoAt + 10], [0, 0.42, 0.42, 0.16], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, height: 520, opacity: roomDim > 0 ? 1 : 0 }}>
        <Portraits named={false} h={430} drift={0.9} dim={roomDim} />
      </div>
      {lines.map((l, i) => {
        const end = lines[i + 1]?.at ?? logoAt;
        const s = spring({ frame: f - l.at, fps, config: { damping: 18 } });
        const out = interpolate(f, [end - 6, end + 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return f >= l.at - 2 && f < end + 6 ? (
          <AbsoluteFill key={i} style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ fontFamily, fontWeight: 800, fontSize: 96, letterSpacing: -3, color: C.ink, opacity: s * out, transform: `scale(${0.94 + s * 0.06})`, textShadow: '0 6px 40px rgba(0,0,0,.8)' }}>{rich(l.text)}</div>
          </AbsoluteFill>
        ) : null;
      })}
      {f >= logoAt - 2 && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 26 }}>
          <div style={{ opacity: logo, transform: `scale(${0.8 + logo * 0.2})` }}><Logo size={190} glow={logo} /></div>
          <div style={{ fontFamily, fontWeight: 600, fontSize: 44, color: C.ink, opacity: interpolate(f, [logoAt + 14, logoAt + 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
            Point your phone at someone. <span style={{ color: C.accent }}>Know who they are.</span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

const ScreenScene: React.FC<{ trim: number }> = ({ trim }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 20 } });
  const W = 1180, H = Math.round(W * 9 / 16);
  return (
    <>
      <div style={{ position: 'absolute', left: 90, top: (1080 - H) / 2 - 20 + (1 - s) * 60, width: W + 28, opacity: s }}>
        <div style={{ padding: 14, borderRadius: 26, background: 'linear-gradient(160deg,#2c2937,#111017)', boxShadow: '0 60px 140px rgba(0,0,0,.7), 0 0 0 1.5px #4a4459, 0 0 100px rgba(177,76,255,.18)' }}>
          <div style={{ position: 'relative', width: W, height: H, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <OffthreadVideo src={staticFile('hunt-screen.mp4')} trimBefore={trim} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
        <div style={{ margin: '0 auto', width: 160, height: 46, background: 'linear-gradient(#1c1a24,#121118)' }} />
        <div style={{ margin: '0 auto', width: 360, height: 12, borderRadius: 6, background: '#1c1a24' }} />
      </div>
      <Captions kicker="04 · The big screen" caps={[{ at: 4, title: 'The room plays *along.*', sub: 'Live feed, most haunted, top hunters, and one QR to join.' }]} left={1370} width={480} size={62} />
    </>
  );
};

const How: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const rows = [
    { icon: '📱', title: 'Matching runs on the phone.', sub: 'Detector, landmarks and a 7 MB open-source embedder, in the browser.' },
    { icon: '✋', title: 'Opt-in, enforced by the server.', sub: 'Only people who said yes can be found. No face ever goes to a hosted AI model.' },
    { icon: '🔗', title: 'No app. One link.', sub: 'iOS Safari and Android Chrome, over HTTPS.' },
  ];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1240, fontFamily }}>
        <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', color: C.glowSoft, marginBottom: 34, opacity: spring({ frame: f, fps }) }}>How it holds up</div>
        {rows.map((r, i) => {
          const s = spring({ frame: f - 6 - i * 9, fps, config: { damping: 18 } });
          return (
            <div key={i} style={{ display: 'flex', gap: 34, alignItems: 'center', marginBottom: 40, opacity: s, transform: `translateX(${(1 - s) * 60}px)` }}>
              <div style={{ width: 104, height: 104, borderRadius: 28, background: 'rgba(177,76,255,.13)', border: '1px solid rgba(177,76,255,.35)', display: 'grid', placeItems: 'center', fontSize: 54, flex: 'none' }}>{r.icon}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 52, letterSpacing: -1.5, color: C.ink }}>{r.title}</div>
                <div style={{ fontWeight: 500, fontSize: 28, color: C.mute, marginTop: 6 }}>{r.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16, stiffness: 90 } });
  const late = (d: number) => interpolate(f, [d, d + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 150, top: 150, fontFamily }}>
        <div style={{ opacity: s, transform: `scale(${0.9 + 0.1 * s})`, transformOrigin: 'left center' }}><Logo size={150} /></div>
        <div style={{ fontWeight: 700, fontSize: 46, color: C.ink, marginTop: 26, opacity: late(8) }}>Point your phone at someone.<br /><span style={{ color: C.accent }}>Know who they are.</span></div>
        <div style={{ fontWeight: 600, fontSize: 28, color: C.mute, marginTop: 26, letterSpacing: 1, opacity: late(14) }}>Opt-in · On-device matching · No app</div>
        <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', color: C.glowSoft, marginTop: 38, opacity: late(20) }}>Live on Base44</div>
        <div style={{ fontWeight: 800, fontSize: 56, color: C.ink, marginTop: 8, letterSpacing: -1, opacity: late(20) }}>{LIVE}</div>
      </div>
      <div style={{ position: 'absolute', right: 170, top: 170, textAlign: 'center', opacity: late(16), transform: `translateY(${(1 - late(16)) * 30}px)` }}>
        <div style={{ padding: 18, borderRadius: 28, background: '#fff', boxShadow: '0 0 80px rgba(177,76,255,.35)' }}><QR text={`https://${LIVE}/register`} size={330} /></div>
        <div style={{ fontFamily, fontWeight: 700, fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: C.glowSoft, marginTop: 18 }}>Scan to be findable</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 700, height: 250, opacity: late(26) }}>
        <Portraits named h={150} drift={0} dim={1} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, textAlign: 'center', fontFamily, fontWeight: 500, fontSize: 20, color: '#8a84a0', opacity: late(30) }}>
        Simulated run: every person in this video is AI-generated. Real app, real code, recorded on a local server. Built at Stranger Builds, Halloween 2026.
      </div>
    </AbsoluteFill>
  );
};

// ---------- the film ----------
export const Promo: React.FC<{ marks: Marks }> = ({ marks }) => {
  const { durationInFrames } = useVideoConfig();
  const scenes = plan(marks);
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop />
      {scenes.map((sc, i) => {
        const at = from; from += sc.dur - XF;
        return (
          <Sequence key={sc.key} from={at} durationInFrames={sc.dur} name={sc.key}>
            <SceneFade dur={sc.dur}>{sc.el}</SceneFade>
          </Sequence>
        );
      })}
      <Audio src={staticFile('music.wav')} volume={(f) => interpolate(f, [0, 12, durationInFrames - 50, durationInFrames - 4], [0, 0.62, 0.62, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) })} />
    </AbsoluteFill>
  );
};
