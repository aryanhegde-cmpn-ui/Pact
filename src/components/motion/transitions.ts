'use client';

import { useReducedMotion } from 'motion/react';
import type { Transition } from 'motion/react';

/**
 * The only durations in the app.
 *
 * ---------------------------------------------------------------------------
 * EASED DURATIONS, NEVER SPRINGS.
 * ---------------------------------------------------------------------------
 * A spring overshoots, and overshoot is expressive: it says something about
 * how the app FEELS about the change. Nothing here has feelings about the
 * change. A commitment leaving a list because it was completed, and a
 * commitment leaving because it was abandoned, are the same movement, and a
 * bounce on one of them would be the reward layer arriving through the easing
 * curve.
 *
 * Two speeds:
 *
 *   STATE   150-250ms. Something on this screen changed value.
 *   MODE    up to 350ms. The screen itself changed -- recovery mode replacing
 *           the dashboard, focus mode opening. Slower so it registers as
 *           deliberate rather than as a navigation glitch.
 * ---------------------------------------------------------------------------
 */
export const STATE_CHANGE: Transition = { duration: 0.2, ease: [0.4, 0, 0.2, 1] };
export const MODE_CHANGE: Transition = { duration: 0.32, ease: [0.4, 0, 0.2, 1] };

/** Instant. What every transition becomes under reduced motion. */
export const CUT: Transition = { duration: 0 };

/**
 * The transition to use, given the viewer's preference.
 *
 * ---------------------------------------------------------------------------
 * REDUCED MOTION MEANS CUTS, NOT SLOWER ANIMATION.
 * ---------------------------------------------------------------------------
 * Halving the duration is the common mistake and it misreads the setting.
 * Someone who has asked for reduced motion is often asking because motion
 * makes them ill; a shorter animation is still animation. `duration: 0` is the
 * honest answer -- the element still moves to its new position, it simply does
 * not travel there.
 * ---------------------------------------------------------------------------
 */
export function useTransition(kind: 'state' | 'mode' = 'state'): Transition {
  const reduced = useReducedMotion();
  if (reduced) return CUT;

  return kind === 'mode' ? MODE_CHANGE : STATE_CHANGE;
}

/**
 * Whether to animate at all.
 *
 * Some effects have no meaningful zero-duration form -- a crossfade with no
 * duration is just the second thing appearing, which is correct, but a layout
 * animation with no duration still costs the measurement work for nothing.
 */
export function useShouldAnimate(): boolean {
  return !useReducedMotion();
}
