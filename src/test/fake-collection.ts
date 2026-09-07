/**
 * An in-memory stand-in for a Mongoose model, with the parts materialisation
 * actually depends on: a unique index, and `insertMany({ ordered: false })`
 * that inserts what it can and reports the rest as duplicate-key write errors.
 *
 * Shared because those semantics are the whole concurrency story. A mock whose
 * `insertMany` always succeeds would let a batch writer look correct while
 * silently attributing another invocation's rows to itself, and the tests would
 * agree with it.
 *
 * Test-only. Nothing under `src/lib` or `src/app` imports this.
 */

export const DUPLICATE_KEY = 11_000;

export interface FakeCollectionOptions {
  /** Fields forming the unique index, if the real collection has one. */
  uniqueBy?: string[];
  /** Counts every call, so a test can assert round trips rather than results. */
  calls?: Record<string, number>;
}

function duplicateKeyError(writeErrors: { index: number; code: number }[]): Error {
  const error = new Error('E11000 duplicate key error collection') as Error & {
    code: number;
    writeErrors: { index: number; code: number }[];
  };
  error.code = DUPLICATE_KEY;
  error.writeErrors = writeErrors;

  return error;
}

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;

  return (a as number) < (b as number) ? -1 : 1;
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$or') {
      return (condition as Record<string, unknown>[]).some((clause) => matches(row, clause));
    }

    const value = row[field];
    if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
      if (field === '_id') return String(value) === String(condition);
      if (condition instanceof Date) return compare(value, condition) === 0;

      return value === condition;
    }

    const operators = condition as Record<string, unknown>;

    return Object.entries(operators).every(([operator, operand]) => {
      switch (operator) {
        case '$in':
          return (operand as unknown[]).some((entry) => String(entry) === String(value));
        case '$nin':
          return !(operand as unknown[]).some((entry) => String(entry) === String(value));
        case '$ne':
          return value !== operand;
        case '$gte':
          return compare(value, operand) >= 0;
        case '$lte':
          return compare(value, operand) <= 0;
        case '$gt':
          return compare(value, operand) > 0;
        case '$lt':
          return compare(value, operand) < 0;
        case '$exists':
          return (value !== undefined) === operand;
        default:
          throw new Error(`fake collection: unsupported operator ${operator}`);
      }
    });
  });
}

export function fakeCollection(
  rows: Record<string, unknown>[],
  options: FakeCollectionOptions = {},
) {
  const count = (name: string) => {
    if (options.calls) options.calls[name] = (options.calls[name] ?? 0) + 1;
  };

  const keyOf = (row: Record<string, unknown>): string | null => {
    if (!options.uniqueBy) return null;

    return options.uniqueBy
      .map((field) => {
        const value = row[field];
        return value instanceof Date ? String(value.getTime()) : String(value);
      })
      .join(' | ');
  };

  const query = (initial: () => Record<string, unknown>[]) => {
    let result = initial;
    const chain = {
      sort: () => chain,
      limit: (n: number) => {
        const inner = result;
        result = () => inner().slice(0, n);
        return chain;
      },
      skip: (n: number) => {
        const inner = result;
        result = () => inner().slice(n);
        return chain;
      },
      lean: async () => result(),
    };

    return chain;
  };

  return {
    rows,
    find: (filter: Record<string, unknown> = {}) => {
      count('find');
      return query(() => rows.filter((row) => matches(row, filter)));
    },
    findOne: (filter: Record<string, unknown>) => {
      count('findOne');
      return { lean: async () => rows.find((row) => matches(row, filter)) ?? null };
    },
    countDocuments: async (filter: Record<string, unknown> = {}) => {
      count('countDocuments');
      return rows.filter((row) => matches(row, filter)).length;
    },
    create: async (doc: Record<string, unknown>) => {
      count('create');
      const key = keyOf(doc);
      if (key !== null && rows.some((row) => keyOf(row) === key)) {
        throw duplicateKeyError([{ index: 0, code: DUPLICATE_KEY }]);
      }

      const saved = { _id: `id-${rows.length + 1}`, ...doc };
      rows.push(saved);

      return saved;
    },
    insertMany: async (docs: Record<string, unknown>[]) => {
      count('insertMany');
      const writeErrors: { index: number; code: number }[] = [];

      for (const [index, doc] of docs.entries()) {
        const key = keyOf(doc);
        if (key !== null && rows.some((row) => keyOf(row) === key)) {
          writeErrors.push({ index, code: DUPLICATE_KEY });
          continue;
        }
        rows.push({ _id: `id-${rows.length + 1}`, ...doc });
      }

      // An unordered insert reports per-row failures rather than stopping.
      if (writeErrors.length > 0) throw duplicateKeyError(writeErrors);

      return docs;
    },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      count('updateOne');
      const row = rows.find((entry) => matches(entry, filter));
      if (row) Object.assign(row, (update.$set ?? {}) as object);

      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    },
    updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      count('updateMany');
      const matched = rows.filter((entry) => matches(entry, filter));
      for (const row of matched) Object.assign(row, (update.$set ?? {}) as object);

      return { matchedCount: matched.length, modifiedCount: matched.length };
    },
  };
}
