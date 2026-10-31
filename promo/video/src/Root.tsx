import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Promo, totalFrames, type Marks } from './Promo';

// marks.json comes from promo/sim.mjs: wall-clock moments of each simulated run. Later entries win (a re-run scene).
async function loadMarks(): Promise<Marks> {
  const list: { label: string; t: number }[] = await (await fetch(staticFile('marks.json'))).json();
  const marks: Marks = {};
  for (const m of list) marks[m.label] = m.t;
  return marks;
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Promo"
    component={Promo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={2100}
    defaultProps={{ marks: {} as Marks }}
    calculateMetadata={async () => {
      const marks = await loadMarks();
      return { props: { marks }, durationInFrames: totalFrames(marks) };
    }}
  />
);
