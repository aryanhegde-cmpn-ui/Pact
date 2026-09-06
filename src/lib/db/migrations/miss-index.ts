import 'server-only';

/**
 * Migration: replace the DEADLINE_MISSED uniqueness index.
 *
 * Old key: (entityId, type). New key: (entityId, type, ts).
 *
 * Both are unique partial indexes filtered to DEADLINE_MISSED, so they enforce
 * incompatible constraints, and Mongoose will NOT replace one with the other --
 * `ensureIndexes` creates only what is missing. The old index therefore
 * survives a deploy and keeps enforcing "one miss per commitment, ever",
 * silently dropping every repeated miss.
 *
 * Separated from the script so the ordering and the failure paths can be
 * tested. Getting those wrong is how a collection ends up with no uniqueness
 * index at all.
 */

export const OLD_INDEX_NAME = 'entityId_1_type_1';
export const NEW_INDEX_NAME = 'entityId_1_type_1_ts_1';

export const NEW_INDEX_SPEC = { entityId: 1, type: 1, ts: 1 } as const;
export const NEW_INDEX_OPTIONS = {
  name: NEW_INDEX_NAME,
  unique: true,
  partialFilterExpression: { type: 'DEADLINE_MISSED' },
} as const;

/**
 * The subset of a Mongo collection this migration needs.
 *
 * Deliberately loose in its argument types so the driver's own `Collection`
 * satisfies it structurally -- the point is to be able to pass either the real
 * collection or an in-memory fake.
 */
export interface IndexedCollection {
  indexes: () => Promise<{ name?: string; unique?: boolean }[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIndex: (spec: any, options?: any) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dropIndex: (name: string, options?: any) => Promise<any>;
}

export interface MigrationResult {
  ok: boolean;
  created: string[];
  dropped: string[];
  /** Present when ok is false. Written to stderr by the caller. */
  error?: string;
  /** True when there was nothing to do. */
  alreadyMigrated: boolean;
}

/**
 * Creates the new index BEFORE dropping the old one.
 *
 * The two can coexist -- different names, different keys -- so building the
 * replacement first means a failure at any point leaves at least one
 * uniqueness constraint standing. Dropping first opens a window with none, and
 * a collection with no index is worse than one with the wrong index: the wrong
 * index loses repeated misses, but no index lets concurrent invocations write
 * true duplicates that nothing will ever reconcile.
 */
export async function migrateMissIndex(collection: IndexedCollection): Promise<MigrationResult> {
  const created: string[] = [];
  const dropped: string[] = [];

  const before = await collection.indexes();
  const hasOld = before.some((index) => index.name === OLD_INDEX_NAME);
  const hasNew = before.some((index) => index.name === NEW_INDEX_NAME);

  if (!hasOld && hasNew) {
    return { ok: true, created, dropped, alreadyMigrated: true };
  }

  if (!hasNew) {
    try {
      await collection.createIndex(NEW_INDEX_SPEC, NEW_INDEX_OPTIONS);
      created.push(NEW_INDEX_NAME);
    } catch (error) {
      // Nothing was dropped, so the collection is still constrained.
      return {
        ok: false,
        created,
        dropped,
        alreadyMigrated: false,
        error:
          `Failed to create ${NEW_INDEX_NAME}: ${message(error)}\n` +
          'Nothing was dropped, so the collection is still constrained by the old index.',
      };
    }
  }

  if (hasOld) {
    try {
      await collection.dropIndex(OLD_INDEX_NAME);
      dropped.push(OLD_INDEX_NAME);
    } catch (error) {
      return {
        ok: false,
        created,
        dropped,
        alreadyMigrated: false,
        error:
          `Failed to drop ${OLD_INDEX_NAME}: ${message(error)}\n` +
          'The new index exists, so nothing is unconstrained -- but the old one is\n' +
          'still enforcing "one miss per commitment, ever". Re-run this migration.',
      };
    }
  }

  // Verify rather than assume. The entire reason this script exists is that an
  // index state can silently differ from what the models declare.
  const after = await collection.indexes();
  const stillOld = after.some((index) => index.name === OLD_INDEX_NAME);
  const nowNew = after.some((index) => index.name === NEW_INDEX_NAME);

  if (stillOld || !nowNew) {
    return {
      ok: false,
      created,
      dropped,
      alreadyMigrated: false,
      error: `Did not converge. old present: ${stillOld}, new present: ${nowNew}`,
    };
  }

  return { ok: true, created, dropped, alreadyMigrated: false };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
