import { z } from 'zod';

/**
 * Rewards and consequences: the stakes an Overseer administers.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE NOT IN-APP REWARDS.
 * ---------------------------------------------------------------------------
 * The anti-feature list bans XP, levels, badges and confetti, and it still
 * does. Those are internal currency: a number the app gives itself for
 * behaviour it also measures, a closed loop with no external referent.
 *
 * This is the opposite. A second person holds the outcome. They see the
 * adherence record and grant or withhold something that actually matters
 * outside the app, and the app's only job in the arrangement is to be an
 * honest witness -- report what happened, including the unflattering parts,
 * decide nothing, apply nothing, soften nothing.
 *
 * That is why none of this is drawn in the accent colour and nothing here
 * celebrates. A reward being available is a fact stated plainly, the same way
 * a consequence being active is.
 * ---------------------------------------------------------------------------
 */

/**
 * The longest a consequence may run.
 *
 * ONE constant, enforced in the schema rather than left to the Overseer's
 * judgement in the moment. docs/product.md is explicit: a month-long
 * consequence stops functioning as motivation and becomes background
 * resentment, and the source specification contradicts itself by saying
 * consequences reset daily or weekly while giving "no ice cream for a month"
 * as an example. The config resolves it.
 *
 * Seven days because that is the longest window in which the thing being
 * withheld is still connected to the week that caused it.
 */
export const MAX_CONSEQUENCE_WINDOW_DAYS = 7;

/**
 * The rolling adherence window triggers evaluate over.
 *
 * A RATE over a window, never a consecutive-day count. A streak has a cliff --
 * miss one day at forty and it reads zero -- and gating real-world stakes on a
 * number that can collapse to zero for one bad Tuesday is how someone
 * abandons the arrangement rather than the habit. docs/product.md, Conflict 1.
 */
export const ADHERENCE_WINDOW_DAYS = 21;

// --- Triggers ---------------------------------------------------------------

export const triggerKindSchema = z.enum([
  /** Adherence over the rolling window crosses a rate. */
  'adherence-threshold',
  /** A countable amount of the plan is finished. */
  'milestone',
  /** The Overseer decides, with no rule. Rewards only. */
  'manual-grant',
]);
export type TriggerKind = z.infer<typeof triggerKindSchema>;

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  'adherence-threshold': 'Adherence over the last three weeks',
  milestone: 'A milestone in the plan',
  'manual-grant': 'Granted by hand',
};

/**
 * A rate between 0 and 1.
 *
 * Rates rather than day counts, so the threshold means the same thing whether
 * the window had twenty-one days with blocks or nine.
 */
const rate = z.number().min(0).max(1);

export const triggerConfigSchema = z
  .object({
    /** For `adherence-threshold`. Fires below this for a consequence, at or above for a reward. */
    thresholdRate: rate.optional(),
    /** For `milestone`. Number of P0 topics done. */
    topicsDone: z.number().int().min(1).max(500).optional(),
  })
  .default({});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

// --- Discharge --------------------------------------------------------------

/**
 * What ends a consequence early.
 *
 * ---------------------------------------------------------------------------
 * THE PRIMARY DISCHARGES BY DOING THE WORK, NEVER BY DISMISSING.
 * ---------------------------------------------------------------------------
 * The source specification's rule is that recovering a missed commitment
 * unlocks its consequence, and that is the entire mechanism. A consequence
 * with a dismiss button is a notification. A consequence that ends when the
 * thing that caused it is put right is a reason to put it right.
 *
 * So the condition is tied to what triggered it, satisfied automatically, and
 * there is no route anywhere that clears one on request.
 */
export const dischargeKindSchema = z.enum([
  /** Adherence returns to the threshold that was missed. */
  'adherence-recovered',
  /** The specific commitment whose miss triggered this is completed or answered. */
  'commitment-resolved',
  /** The milestone that was missed is reached. */
  'milestone-reached',
]);
export type DischargeKind = z.infer<typeof dischargeKindSchema>;

export const DISCHARGE_LABELS: Record<DischargeKind, string> = {
  'adherence-recovered': 'Get adherence back to the threshold',
  'commitment-resolved': 'Finish or answer for the commitment that triggered it',
  'milestone-reached': 'Reach the milestone',
};

export const dischargeConditionSchema = z.object({
  kind: dischargeKindSchema,
  /** For `adherence-recovered`. The rate to return to. */
  thresholdRate: rate.optional(),
  /** For `commitment-resolved`. */
  commitmentId: z.string().optional(),
  /** For `milestone-reached`. */
  topicsDone: z.number().int().min(1).optional(),
});
export type DischargeCondition = z.infer<typeof dischargeConditionSchema>;

// --- Status -----------------------------------------------------------------

export const rewardStatusSchema = z.enum(['available', 'earned', 'claimed', 'expired']);
export type RewardStatus = z.infer<typeof rewardStatusSchema>;

export const consequenceStatusSchema = z.enum(['pending', 'active', 'discharged', 'expired']);
export type ConsequenceStatus = z.infer<typeof consequenceStatusSchema>;

export const CONSEQUENCE_STATUS_LABELS: Record<ConsequenceStatus, string> = {
  pending: 'configured, not triggered',
  active: 'active',
  discharged: 'discharged',
  expired: 'expired',
};

// --- Request shapes ---------------------------------------------------------

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().min(1).max(1_000);

export const createRewardSchema = z.object({
  name,
  description,
  trigger: triggerKindSchema,
  triggerConfig: triggerConfigSchema,
});
export type CreateRewardInput = z.infer<typeof createRewardSchema>;

export const createConsequenceSchema = z
  .object({
    name,
    description,
    trigger: triggerKindSchema.exclude(['manual-grant']),
    triggerConfig: triggerConfigSchema,
    /**
     * How long it runs once triggered.
     *
     * Capped by the schema, not by the form. A cap that only exists in the UI
     * is a cap the API does not have.
     */
    windowDays: z.number().int().min(1).max(MAX_CONSEQUENCE_WINDOW_DAYS),
    dischargeCondition: dischargeConditionSchema,
  })
  .refine(
    (value) =>
      value.trigger !== 'adherence-threshold' || value.triggerConfig.thresholdRate !== undefined,
    { message: 'An adherence trigger needs a threshold rate', path: ['triggerConfig'] },
  );
export type CreateConsequenceInput = z.infer<typeof createConsequenceSchema>;

/**
 * What an Overseer may change after the fact.
 *
 * Deliberately narrow. Status is absent: a consequence's status is derived from
 * triggers, discharge and expiry, and letting it be set by hand would make
 * "discharged" something that can be granted rather than earned.
 */
export const editStakeSchema = z.object({
  name: name.optional(),
  description: description.optional(),
});

/** The Overseer granting a `manual-grant` reward. */
export const grantRewardSchema = z.object({ rewardId: z.string().min(1) });

/** The primary claiming a reward they have earned. */
export const claimRewardSchema = z.object({ rewardId: z.string().min(1) });

export const setVacationSchema = z.object({
  on: z.boolean(),
  /** Optional note, for the primary's own record. Never shown to the overseer. */
  note: z.string().trim().max(500).optional(),
});
