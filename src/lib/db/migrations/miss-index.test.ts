import { describe, expect, it, vi } from 'vitest';

import {
  migrateMissIndex,
  NEW_INDEX_NAME,
  OLD_INDEX_NAME,
  type IndexedCollection,
} from './miss-index';

/** An in-memory collection that records the order operations happened in. */
function fakeCollection(
  initial: string[],
  overrides: Partial<IndexedCollection> = {},
): IndexedCollection & { names: string[]; order: string[] } {
  const names = [...initial];
  const order: string[] = [];

  return {
    names,
    order,
    indexes: async () => names.map((name) => ({ name })),
    createIndex: async (_spec, options) => {
      const name = (options as { name: string }).name;
      order.push(`create:${name}`);
      names.push(name);
      return name;
    },
    dropIndex: async (name: string) => {
      order.push(`drop:${name}`);
      const at = names.indexOf(name);
      if (at !== -1) names.splice(at, 1);
      return {};
    },
    ...overrides,
  };
}

describe('migrateMissIndex', () => {
  it('replaces the old index with the new one', async () => {
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME]);

    const result = await migrateMissIndex(collection);

    expect(result.ok).toBe(true);
    expect(result.created).toEqual([NEW_INDEX_NAME]);
    expect(result.dropped).toEqual([OLD_INDEX_NAME]);
    expect(collection.names).toEqual(['_id_', NEW_INDEX_NAME]);
  });

  it('CREATES before it DROPS, so no window exists with neither index', async () => {
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME]);

    await migrateMissIndex(collection);

    // A collection with no uniqueness index is worse than one with the wrong
    // index: the wrong index loses repeated misses, but none at all lets
    // concurrent invocations write true duplicates nothing will reconcile.
    expect(collection.order).toEqual([`create:${NEW_INDEX_NAME}`, `drop:${OLD_INDEX_NAME}`]);
  });

  it('is idempotent: a second run is a no-op', async () => {
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME]);

    await migrateMissIndex(collection);
    const second = await migrateMissIndex(collection);

    expect(second.ok).toBe(true);
    expect(second.alreadyMigrated).toBe(true);
    expect(second.created).toEqual([]);
    expect(second.dropped).toEqual([]);
  });

  it('is a no-op on a collection that never had the old index', async () => {
    const collection = fakeCollection(['_id_', NEW_INDEX_NAME]);

    const result = await migrateMissIndex(collection);

    expect(result).toMatchObject({ ok: true, alreadyMigrated: true });
    expect(collection.order).toEqual([]);
  });

  it('creates the new index on a collection that has neither', async () => {
    const collection = fakeCollection(['_id_']);

    const result = await migrateMissIndex(collection);

    expect(result.ok).toBe(true);
    expect(result.created).toEqual([NEW_INDEX_NAME]);
    expect(result.dropped).toEqual([]);
  });

  it('FAILS without dropping when the create fails', async () => {
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME], {
      createIndex: async () => {
        throw new Error('E11000 duplicate key on existing rows');
      },
    });

    const result = await migrateMissIndex(collection);

    expect(result.ok).toBe(false);
    expect(result.dropped).toEqual([]);
    // The old index must survive: leaving nothing is the worse failure.
    expect(collection.names).toContain(OLD_INDEX_NAME);
    expect(result.error).toContain('still constrained');
  });

  it('FAILS loudly when the drop fails, leaving the new index in place', async () => {
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME], {
      dropIndex: async () => {
        throw new Error('index not found or in use');
      },
    });

    const result = await migrateMissIndex(collection);

    expect(result.ok).toBe(false);
    expect(result.created).toEqual([NEW_INDEX_NAME]);
    expect(result.error).toContain('Re-run this migration');
    // Nothing is unconstrained, but repeated misses are still being dropped,
    // so this must not be reported as success.
    expect(collection.names).toContain(NEW_INDEX_NAME);
  });

  it('FAILS when the final state does not match what was intended', async () => {
    // Both operations report success but the collection disagrees -- exactly
    // the silent divergence this migration exists to catch.
    const collection = fakeCollection(['_id_', OLD_INDEX_NAME], {
      dropIndex: vi.fn().mockResolvedValue({}),
    });

    const result = await migrateMissIndex(collection);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Did not converge');
  });
});
