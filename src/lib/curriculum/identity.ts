import type { BlockId } from '@/lib/schemas/curriculum';

/**
 * How a curriculum row is identified across imports.
 *
 * Pure. No I/O, no clock.
 */

/**
 * A slug that is stable under the edits a spreadsheet actually receives.
 *
 * Case, surrounding whitespace and punctuation are normalised away, because
 * "this / that" becoming "this/that" is a typo fix, not a different topic.
 * Words are not: renaming a topic IS a different topic, and silently treating
 * it as the same one would move progress onto material the user never studied.
 */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The import key: block, module, topic, sub-topic.
 *
 * Derived from what the row IS rather than from where it sits, so inserting a
 * row halfway down the sheet does not renumber every key below it and orphan
 * their progress. Empty segments are kept as empty so a row that later gains a
 * sub-topic is correctly a NEW row rather than silently the same one.
 */
export function topicKey(parts: {
  blockId: string;
  module: string;
  topic: string;
  subTopic: string;
}): string {
  return [parts.blockId, slug(parts.module), slug(parts.topic), slug(parts.subTopic)].join('/');
}

export function interviewKey(parts: { category: string; topic: string }): string {
  return [slug(parts.category), slug(parts.topic)].join('/');
}

/**
 * Splits the workbook's Block column.
 *
 * The column reads "Block 2 — Machine Coding": a block identity and a category
 * within it, in one cell. Block 2 alone holds six categories, so treating the
 * whole string as the block would give the generator six 8:00 windows.
 *
 * Returns null rather than guessing when the cell does not have that shape --
 * a row whose block cannot be identified must not be silently filed under
 * block 1.
 */
export function splitBlockCell(cell: string): { blockId: BlockId; category: string } | null {
  const match = /^\s*Block\s*([123])\s*(?:[—–-]\s*(.*))?$/i.exec(cell);
  if (!match) return null;

  const blockId = `block-${match[1]}` as BlockId;
  const category = (match[2] ?? '').trim();

  return { blockId, category: category === '' ? 'General' : category };
}
