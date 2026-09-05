import { z } from 'zod';

import { prioritySchema } from '@/lib/schemas/commitment';
import { isDateKey } from '@/lib/time';

const dateKeySchema = z.string().refine(isDateKey, { message: 'must be YYYY-MM-DD' });

export const frequencySchema = z.enum(['daily', 'weekly', 'monthly']);
export type Frequency = z.infer<typeof frequencySchema>;

export const seriesStatusSchema = z.enum(['active', 'ended']);
export type SeriesStatus = z.infer<typeof seriesStatusSchema>;

/**
 * The recurrence rule.
 *
 * Evaluated in APP_TIMEZONE, because "every Tuesday at 09:00" is a statement
 * about local calendar days -- the UTC instant it lands on moves with the
 * offset. `timeOfDay` is a wall clock for that reason, not an instant.
 */
export const recurrenceRuleSchema = z
  .object({
    frequency: frequencySchema,
    /** Every N periods. 2 with `weekly` is fortnightly. */
    interval: z.number().int().min(1).max(52).default(1),
    /** 0 = Sunday. Only meaningful for `weekly`. */
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    /** Wall clock in APP_TIMEZONE, `HH:MM`. */
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'must be HH:MM'),
    estimateMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  })
  .refine((rule) => rule.frequency !== 'weekly' || rule.byWeekday.length > 0, {
    message: 'A weekly series needs at least one weekday',
    path: ['byWeekday'],
  });
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const seriesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(500),
  rule: recurrenceRuleSchema,
  priority: prioritySchema,
  startDate: dateKeySchema,
  /** Null means open-ended. */
  endDate: dateKeySchema.nullable(),
  status: seriesStatusSchema,
  createdAt: z.date(),
});
export type Series = z.infer<typeof seriesSchema>;

export const createSeriesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(500),
  rule: recurrenceRuleSchema,
  priority: prioritySchema,
  startDate: dateKeySchema,
  endDate: dateKeySchema.nullable().optional(),
});
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

/**
 * How far an edit reaches.
 *
 * There is no "all occurrences", and that is not an oversight. Past
 * occurrences are historical fact: what you committed to last Tuesday does not
 * change because you changed your mind today, and rewriting them would make
 * the behaviour engine's read of your history a lie.
 *
 * `this-and-future` is implemented as ending the current series today and
 * starting a new one -- so the old rule keeps describing the occurrences it
 * actually produced.
 */
export const editScopeSchema = z.enum(['this-occurrence', 'this-and-future']);
export type EditScope = z.infer<typeof editScopeSchema>;

export const updateSeriesSchema = z
  .object({
    scope: editScopeSchema,
    title: z.string().trim().min(1).max(200).optional(),
    outcome: z.string().trim().min(1).max(500).optional(),
    rule: recurrenceRuleSchema.optional(),
    priority: prioritySchema.optional(),
    /** Required for `this-occurrence`: which one. */
    occurrenceDate: dateKeySchema.optional(),
  })
  .strict()
  .refine((value) => value.scope !== 'this-occurrence' || Boolean(value.occurrenceDate), {
    message: 'occurrenceDate is required when editing a single occurrence',
    path: ['occurrenceDate'],
  });
export type UpdateSeriesInput = z.infer<typeof updateSeriesSchema>;

/** How far ahead occurrences are materialised past the end of a queried range. */
export const LOOKAHEAD_DAYS = 14;
