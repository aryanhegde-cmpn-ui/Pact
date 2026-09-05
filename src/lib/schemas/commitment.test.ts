import { describe, expect, it } from 'vitest';

import {
  changeDeadlineSchema,
  createCommitmentSchema,
  dateRangeSchema,
  updateCommitmentSchema,
} from './commitment';

const valid = {
  title: 'Ship the report',
  outcome: 'The report is in Priya’s inbox',
  dueAt: '2026-09-05T12:00:00.000Z',
  estimateMinutes: 90,
  priority: 'must-win',
};

describe('createCommitmentSchema', () => {
  it('accepts a complete commitment', () => {
    expect(createCommitmentSchema.parse(valid).title).toBe('Ship the report');
  });

  it.each(['title', 'outcome', 'dueAt', 'estimateMinutes', 'priority'])(
    'requires %s -- there is no quick-add',
    (field) => {
      const partial: Record<string, unknown> = { ...valid };
      delete partial[field];

      expect(createCommitmentSchema.safeParse(partial).success).toBe(false);
    },
  );

  it('rejects an empty outcome, which is the whole point of the field', () => {
    expect(createCommitmentSchema.safeParse({ ...valid, outcome: '   ' }).success).toBe(false);
  });

  it('rejects a nonsensical estimate', () => {
    expect(createCommitmentSchema.safeParse({ ...valid, estimateMinutes: 0 }).success).toBe(false);
    expect(createCommitmentSchema.safeParse({ ...valid, estimateMinutes: -5 }).success).toBe(false);
    expect(createCommitmentSchema.safeParse({ ...valid, estimateMinutes: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('updateCommitmentSchema', () => {
  it('accepts a descriptive edit', () => {
    expect(updateCommitmentSchema.parse({ title: 'New title' })).toEqual({ title: 'New title' });
  });

  it('REJECTS dueAt', () => {
    // The lockdown, at the schema boundary: a deadline cannot ride along inside
    // an ordinary edit.
    const result = updateCommitmentSchema.safeParse({
      title: 'New title',
      dueAt: '2026-10-01T00:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it.each(['originalDueAt', 'status', 'completedAt', 'createdAt', 'seriesId'])(
    'rejects %s',
    (field) => {
      expect(updateCommitmentSchema.safeParse({ title: 'x', [field]: 'anything' }).success).toBe(
        false,
      );
    },
  );

  it('rejects an empty edit rather than writing nothing and logging an event', () => {
    expect(updateCommitmentSchema.safeParse({}).success).toBe(false);
  });
});

describe('changeDeadlineSchema', () => {
  it('demands a reason', () => {
    expect(changeDeadlineSchema.safeParse({ newDueAt: '2026-10-01T00:00:00Z' }).success).toBe(
      false,
    );
    expect(
      changeDeadlineSchema.safeParse({ newDueAt: '2026-10-01T00:00:00Z', reason: '' }).success,
    ).toBe(false);
  });

  it('accepts a move with a reason', () => {
    const parsed = changeDeadlineSchema.parse({
      newDueAt: '2026-10-01T00:00:00Z',
      reason: 'Blocked on review',
    });

    expect(parsed.reason).toBe('Blocked on review');
  });
});

describe('dateRangeSchema', () => {
  it('accepts a well-formed range', () => {
    expect(dateRangeSchema.parse({ from: '2026-09-01', to: '2026-09-30' }).from).toBe('2026-09-01');
  });

  it('rejects a backwards range', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
  });

  it('rejects a non-date-key', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-9-1', to: '2026-09-30' }).success).toBe(false);
  });
});
