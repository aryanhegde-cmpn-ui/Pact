import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readWorkbook } from './xlsx';

/**
 * Read against the real workbook, which is committed to `data/`.
 *
 * A fixture built by hand would only prove the reader handles a file this
 * repository does not import. No network: the file is on disk.
 */
const WORKBOOK = fileURLToPath(
  new URL('../data/Aryan_SDE2_Frontend_Study_Plan_Jan2027.xlsx', import.meta.url),
);

const book = readWorkbook(WORKBOOK);

describe('readWorkbook', () => {
  it('finds all four sheets, in workbook order', () => {
    expect([...book.keys()]).toEqual(['Daily Plan', 'Curriculum', 'Resources', 'Interview Prep']);
  });

  it('reads every curriculum row', () => {
    // 3 header/legend rows plus 60 topics.
    expect(book.get('Curriculum')).toHaveLength(63);
  });

  it('resolves shared strings rather than returning their indexes', () => {
    expect(book.get('Curriculum')?.[3]).toMatchObject({
      A: 'Block 1 — DSA',
      B: 'Arrays',
      G: '8–10 representative problems',
      H: 'P0',
    });
  });

  it('keeps the en dash and other non-ASCII exactly as written', () => {
    // The practice parser matches on the dash, and the sheet uses an en dash.
    expect(book.get('Curriculum')?.[3]?.G).toContain('–');
  });

  it('keys cells by column letter, so a gap does not shift the row', () => {
    // The curriculum sheet has A-H, then a legend in J-K with I empty.
    const header = book.get('Curriculum')?.[2] ?? {};

    expect(header.H).toBe('Priority');
    expect(header.I).toBeUndefined();
    expect(header.J).toBe('Priority');
  });

  it('decodes XML entities in cell text', () => {
    // "Maps & Sets" is stored as "Maps &amp; Sets".
    const rows = book.get('Curriculum') ?? [];

    expect(rows.some((row) => row.C === 'Maps & Sets')).toBe(true);
  });

  it('drops rows with no cells rather than returning holes', () => {
    for (const rows of book.values()) {
      for (const row of rows) expect(Object.keys(row).length).toBeGreaterThan(0);
    }
  });

  it('throws a readable error on something that is not a workbook', () => {
    expect(() => readWorkbook(fileURLToPath(new URL('./xlsx.ts', import.meta.url)))).toThrow(
      /not a zip|Not a zip/i,
    );
  });
});
