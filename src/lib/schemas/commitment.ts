import { z } from 'zod';

import { isDateKey } from '@/lib/time';

export const commitmentStatusSchema = z.enum(['pending', 'in-progress', 'done', 'abandoned']);
export type CommitmentStatus = z.infer<typeof commitmentStatusSchema>;

/** Statuses where the clock still matters. A done or abandoned thing cannot be missed. */
export const OPEN_STATUSES: readonly CommitmentStatus[] = ['pending', 'in-progress'];

export const prioritySchema = z.enum(['must-win', 'important', 'maintenance']);
export type Priority = z.infer<typeof prioritySchema>;

const dateKeySchema = z.string().refine(isDateKey, { message: 'must be YYYY-MM-DD' });

/**
 * A Commitment. Not a task.
 *
 * The distinction is the product: a task is something on a list, a commitment
 * is something you said you would do, with a deadline you are accountable to.
 * `outcome` is required for the same reason -- "work on the report" cannot be
 * verified as done, "the report is sent to Priya" can.
 */
export const commitmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** What is true when this is finished. Required -- see above. */
  outcome: z.string().trim().min(1).max(500),
  dueAt: z.date(),
  /** Written once, at creation, and never again. See changeDeadline. */
  originalDueAt: z.date(),
  estimateMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  status: commitmentStatusSchema,
  priority: prioritySchema,
  /** Set when this occurrence belongs to a Series. */
  seriesId: z.string().nullable(),
  /** The local calendar date this occurrence represents, in APP_TIMEZONE. */
  occurrenceDate: dateKeySchema.nullable(),
  /** Per-commitment override of the notification lead time, in minutes. */
  leadMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  notes: z.string().max(5_000).default(''),
});
export type Commitment = z.infer<typeof commitmentSchema>;

/**
 * Creating a commitment.
 *
 * Every field here is required. There is deliberately no quick-add: a
 * commitment with no outcome and no estimate is a to-do item, and junk created
 * in two seconds becomes junk history forever. The friction is the feature.
 */
export const createCommitmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(500),
  dueAt: z.coerce.date(),
  estimateMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  priority: prioritySchema,
  notes: z.string().max(5_000).optional(),
  /** Overrides the default notification lead time for this commitment only. */
  leadMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable()
    .optional(),
});
export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;

/**
 * The generic edit path.
 *
 * `dueAt` and `originalDueAt` are absent by design, and `.strict()` turns their
 * presence into a validation failure rather than a silent no-op. Moving a
 * deadline goes through `changeDeadline`, which demands a reason and writes an
 * event; letting it happen here would make the postponement history -- the
 * thing this app exists to show the user -- quietly incomplete.
 */
export const updateCommitmentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    outcome: z.string().trim().min(1).max(500).optional(),
    estimateMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    priority: prioritySchema.optional(),
    notes: z.string().max(5_000).optional(),
    leadMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;

/** Fields the generic update path must never accept, checked explicitly for a clear error. */
export const FORBIDDEN_UPDATE_FIELDS = [
  'dueAt',
  'originalDueAt',
  'status',
  'createdAt',
  'completedAt',
  'startedAt',
  'seriesId',
  'occurrenceDate',
] as const;

/**
 * Moving a deadline.
 *
 * The reason is mandatory. A postponement without one is exactly the
 * frictionless reschedule that lets a deadline drift indefinitely without ever
 * feeling like a decision.
 */
export const changeDeadlineSchema = z.object({
  newDueAt: z.coerce.date(),
  reason: z.string().trim().min(1, 'A reason is required to move a deadline').max(500),
});
export type ChangeDeadlineInput = z.infer<typeof changeDeadlineSchema>;

/** Listing a date range, as local calendar dates in APP_TIMEZONE. */
export const dateRangeSchema = z
  .object({ from: dateKeySchema, to: dateKeySchema })
  .refine((value) => value.from <= value.to, { message: '`from` must not be after `to`' });
export type DateRange = z.infer<typeof dateRangeSchema>;
