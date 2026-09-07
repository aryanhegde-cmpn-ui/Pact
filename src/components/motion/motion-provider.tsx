'use client';

import { LazyMotion, domAnimation } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Motion, loaded as a feature subset.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: MOTION EXPLAINS WHAT CHANGED. IT NEVER REWARDS.
 * ---------------------------------------------------------------------------
 * A completion animation, a spring bounce on a finished block, a flourish on
 * earning a reward -- every one of those is the celebratory animation the
 * anti-feature list bans, arriving as a nice touch. The test is simple and it
 * is the one applied throughout: **if an animation would feel good to trigger
 * repeatedly, it is a reward and it does not ship.**
 *
 * What earns motion here: things leaving a list, things re-sorting, a ring
 * segment changing state, and mode changes. All of those answer "what just
 * moved and where did it come from", which is a question the user actually
 * has. Nothing else does.
 * ---------------------------------------------------------------------------
 *
 * `LazyMotion` with `domAnimation` and the `m` components rather than the full
 * `motion` bundle. This is a PWA opened on a phone, and the difference is most
 * of the library: `domAnimation` covers transforms, opacity and layout, which
 * is everything used here. `domMax` would add drag and layout projection that
 * nothing needs.
 *
 * `strict` makes importing a full `motion.*` component a runtime error rather
 * than a silent doubling of the bundle -- the mistake is invisible otherwise,
 * because the component works.
 */
export function MotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
