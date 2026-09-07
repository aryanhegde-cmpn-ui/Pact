'use client';

import { m } from 'motion/react';

import { useTransition } from '@/components/motion/transitions';

/**
 * The plan ring.
 *
 * ---------------------------------------------------------------------------
 * THREE SEGMENTS, NOT A PROGRESS ARC.
 * ---------------------------------------------------------------------------
 * One arc per block, each either filled or hollow. Not a continuous ring
 * showing a percentage, for two reasons.
 *
 * A continuous arc can misrepresent. It invites a denominator of "everything
 * due today", which would make a day with nine errands look like a day with
 * nine-elevenths of a study plan. The denominator here is exactly three,
 * always, because the ring measures adherence to the PLAN and the plan is
 * three blocks. Other commitments are real work and are listed as such; they
 * are not part of this number.
 *
 * And a continuous arc is the generic choice -- every fitness app has one.
 * Three discrete segments read as an instrument: a gauge with three positions,
 * where partial fill is not a state that exists because a block is done or it
 * is not.
 *
 * There is no colour for "done". A filled segment is `text`, an empty one is
 * `edge`. A green would be a reward for completion, which is the one reward
 * this app is allowed to withhold.
 *
 * The only motion is the stroke changing colour when a block is kept: 200ms,
 * eased, no overshoot. It exists so the change is visible when it happens
 * rather than appearing to have always been that way -- NOT to mark the
 * occasion. A segment that sprang, pulsed or scaled would be a reward for
 * completing, which is exactly what the missing colour is avoiding.
 * ---------------------------------------------------------------------------
 */

interface Segment {
  /** Filled when the block is done. */
  done: boolean;
  /** The one block that needs attention now, if any. Drawn in signal. */
  current: boolean;
}

/** Geometry. A 120-unit box with a 52-unit radius leaves room for the stroke. */
const SIZE = 120;
const RADIUS = 52;
const STROKE = 9;
/** Degrees of blank between segments. Enough to read as three, not as a ring. */
const GAP = 9;

function arcPath(startAngle: number, endAngle: number): string {
  const point = (angle: number) => {
    // -90 so the first segment starts at the top rather than at three o'clock.
    const radians = ((angle - 90) * Math.PI) / 180;

    return [SIZE / 2 + RADIUS * Math.cos(radians), SIZE / 2 + RADIUS * Math.sin(radians)] as const;
  };

  const [x1, y1] = point(startAngle);
  const [x2, y2] = point(endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2} ${y2}`;
}

/**
 * The stroke for a segment, read from the tokens.
 *
 * Resolved to the custom property rather than a class, because a colour
 * transition needs a value on both sides -- and the values still come from the
 * five tokens, never from a literal.
 */
function strokeFor(segment: Segment): string {
  if (segment.done) return 'var(--pact-text)';

  return segment.current ? 'var(--pact-signal)' : 'var(--pact-edge)';
}

export function BlockRing({
  done,
  total,
  currentIndex,
  label,
}: {
  done: number;
  /** Always three when a curriculum exists. Passed in so the ring cannot invent it. */
  total: number;
  /** Which segment is the one to do now, or -1. At most one, ever. */
  currentIndex?: number;
  label?: string;
}): React.JSX.Element {
  const transition = useTransition('state');

  const segments: Segment[] = Array.from({ length: total }, (_, index) => ({
    done: index < done,
    current: index === currentIndex,
  }));

  const sweep = 360 / Math.max(1, total);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-[9.25rem]"
        role="img"
        /**
         * The ring's whole meaning, in words.
         *
         * An SVG of three arcs is nothing at all to a screen reader: no text,
         * no role, no value. This is the one place the number has to be
         * stated rather than drawn, and it carries the label too, because
         * "2 of 3" without a noun could be anything on the page.
         */
        aria-label={`${done} of ${total} ${label ?? 'blocks done'}`}
      >
        {segments.map((segment, index) => (
          <m.path
            key={index}
            d={arcPath(index * sweep + GAP / 2, (index + 1) * sweep - GAP / 2)}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="butt"
            // Animated through CSS custom properties rather than by swapping a
            // class, so the transition has two values to move between.
            animate={{ stroke: strokeFor(segment) }}
            transition={transition}
          />
        ))}
      </svg>

      {/* Centred over the ring rather than inside the SVG, so the figure uses
          the real type stack instead of SVG text metrics. */}
      <div className="-mt-[5.75rem] mb-[3.25rem] flex flex-col items-center">
        <span className="figures-display">{done}</span>
        <span className="text-text/40 mt-2xs text-sm">of {total}</span>
      </div>

      {label ? <p className="text-text/40 text-xs">{label}</p> : null}
    </div>
  );
}
