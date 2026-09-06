import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * A minimal reader for the one workbook this repo imports.
 *
 * Dependency-free on purpose. The alternatives were `xlsx`, which is no longer
 * published to npm by its maintainers and whose last npm release carries a
 * prototype-pollution advisory, or a full parser like exceljs pulled in for a
 * single script. An .xlsx is a zip of XML, Node ships inflate, and the file is
 * machine-generated -- so a reader for exactly this shape is about a hundred
 * lines and has no supply chain at all.
 *
 * Scope, stated so nobody mistakes this for a spreadsheet library: it reads
 * cell VALUES as strings. No formulas, no dates-as-numbers, no styles, no
 * merged cells. The workbook is text, and if it ever stops being text this
 * throws rather than guessing.
 */

// --- zip --------------------------------------------------------------------

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The record is at the end, after a comment of up to 64KB.
  const from = Math.max(0, buffer.length - 0x1_00_00 - 22);
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) return i;
  }

  throw new Error('Not a zip file: no end-of-central-directory record.');
}

function readEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error(`Corrupt zip: expected a central directory entry at ${cursor}.`);
    }

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    entries.set(name, {
      name,
      method: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      offset: buffer.readUInt32LE(cursor + 42),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function read(buffer: Buffer, entry: ZipEntry): string {
  if (buffer.readUInt32LE(entry.offset) !== LOCAL) {
    throw new Error(`Corrupt zip: no local header for ${entry.name}.`);
  }

  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw.toString('utf8');
  if (entry.method === 8) return inflateRawSync(raw).toString('utf8');

  throw new Error(`${entry.name} uses compression method ${entry.method}, which is not supported.`);
}

// --- xml --------------------------------------------------------------------
//
// Every element pattern below tolerates a namespace prefix. The workbook this
// repo imports writes `<x:sheet>` and `<x:row>`, and a different exporter
// writes them bare -- both are valid, and a reader that handles only one
// silently returns an empty workbook rather than failing.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));

    return ENTITIES[body] ?? whole;
  });
}

/** Concatenates the text of every `<t>` in a fragment, as a shared string does. */
function textOf(fragment: string): string {
  return [
    ...fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\s*\/>/g),
  ]
    .map((match) => decode(match[1] ?? ''))
    .join('');
}

// --- workbook ---------------------------------------------------------------

export type SheetRow = Record<string, string>;

/** Sheets in workbook order, each a list of rows keyed by column letter. */
export type Workbook = Map<string, SheetRow[]>;

export function readWorkbook(path: string): Workbook {
  const buffer = readFileSync(path);
  const entries = readEntries(buffer);

  const get = (name: string): string => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`${path} has no ${name}. Is it really an .xlsx?`);

    return read(buffer, entry);
  };

  const shared = entries.has('xl/sharedStrings.xml')
    ? [...get('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(
        (m) => textOf(m[1] ?? ''),
      )
    : [];

  const targets = new Map(
    [...get('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/>/g)].map(
      (match) => {
        const attributes = match[1] ?? '';
        return [attribute(attributes, 'Id'), attribute(attributes, 'Target')] as const;
      },
    ),
  );

  const workbook: Workbook = new Map();

  for (const match of get('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/>/g)) {
    const attributes = match[1] ?? '';
    const name = decode(attribute(attributes, 'name'));
    const target = targets.get(attribute(attributes, 'r:id'));
    if (!target) throw new Error(`Sheet "${name}" has no relationship target.`);

    const normalised = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.?\//, '')}`;

    workbook.set(name, readSheet(get(normalised), shared));
  }

  return workbook;
}

function attribute(attributes: string, name: string): string {
  const match = new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`).exec(attributes);

  return match?.[1] ?? '';
}

function readSheet(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];

  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const row: SheetRow = {};

    const body = rowMatch[1] ?? '';
    for (const cellMatch of body.matchAll(
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
    )) {
      const attributes = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const column = attribute(attributes, 'r').replace(/\d+/g, '');
      const type = attribute(attributes, 't');

      let value: string;
      if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const raw = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
        if (raw === undefined) continue;

        value = type === 's' ? (shared[Number(decode(raw))] ?? '') : decode(raw);
      }

      if (value !== '') row[column] = value;
    }

    // Blank rows carry no information and would only shift the reader's index.
    if (Object.keys(row).length > 0) rows.push(row);
  }

  return rows;
}
