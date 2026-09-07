// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isDestructive, isTypingContext, SEQUENCE_PREFIXES, SHORTCUTS } from './bindings';

/**
 * The rules that make single-key shortcuts safe.
 *
 * Each of these is a rule that, once broken, is broken silently: a destructive
 * binding does the wrong thing only when somebody's cat walks over the
 * keyboard, and an undocumented one is indistinguishable from a bug.
 */
describe('nothing destructive has a key', () => {
  it('binds no action that abandons, discharges or deletes', () => {
    /**
     * Abandoning a commitment, discharging a consequence and toggling vacation
     * mode are decisions. A decision that can be made by brushing a key is not
     * a decision, and two of those three cannot be undone at all.
     */
    const offenders = SHORTCUTS.filter((shortcut) => isDestructive(shortcut.action)).map(
      (shortcut) => shortcut.label,
    );

    expect(offenders).toEqual([]);
  });

  it('recognises a destructive target if one were ever added', () => {
    // Guards the guard: a matcher that matches nothing would make the test
    // above pass for the wrong reason.
    expect(isDestructive({ kind: 'activate', target: 'abandon-commitment' })).toBe(true);
    expect(isDestructive({ kind: 'activate', target: 'toggle-vacation' })).toBe(true);
    expect(isDestructive({ kind: 'activate', target: 'start-next' })).toBe(false);
  });
});

describe('the bindings are unambiguous', () => {
  it('has no duplicate key sequence', () => {
    const seen = SHORTCUTS.map((shortcut) => shortcut.keys.join(' '));

    expect(seen.length).toBe(new Set(seen).size);
  });

  it('never uses a sequence prefix as a single-key binding', () => {
    /**
     * `g` alone and `g` then `t` cannot both exist: the first would fire while
     * the second was being typed, and the navigation would happen before the
     * second key arrived.
     */
    const clashes = SHORTCUTS.filter(
      (shortcut) => shortcut.keys.length === 1 && SEQUENCE_PREFIXES.has(shortcut.keys[0]!),
    ).map((shortcut) => shortcut.label);

    expect(clashes).toEqual([]);
  });

  it('reserves sequences for navigation and single keys for this screen', () => {
    for (const shortcut of SHORTCUTS) {
      if (shortcut.keys.length > 1) expect(shortcut.action.kind).toBe('navigate');
    }
  });
});

/**
 * Read from the working directory rather than `import.meta.url`: happy-dom
 * rewrites the module URL to a non-file scheme, and `fileURLToPath` throws.
 */
function readSheet(): string {
  return readFileSync(join(process.cwd(), 'src/components/shortcuts/shortcut-sheet.tsx'), 'utf8');
}

describe('the sheet is the complete list', () => {
  it('renders from the bindings rather than restating them', () => {
    /**
     * A hand-written sheet drifts, and a shortcut that fires without being
     * listed is a trap. The sheet must import SHORTCUTS and iterate it.
     */
    const sheet = readSheet();

    expect(sheet).toContain("from '@/lib/shortcuts/bindings'");
    expect(sheet).toContain('SHORTCUTS.filter');
    // No literal key would survive a rename of a binding.
    expect(sheet).not.toMatch(/<kbd[^>]*>\s*[a-z]\s*</);
  });

  it('covers every group the bindings use', () => {
    const sheet = readSheet();

    for (const group of new Set(SHORTCUTS.map((shortcut) => shortcut.group))) {
      expect(sheet).toContain(`'${group}'`);
    }
  });

  it('documents Escape even though the dialogs handle it', () => {
    // The sheet is an account of what the keyboard does, not of what this
    // module implements.
    expect(SHORTCUTS.some((shortcut) => shortcut.keys[0] === 'Escape')).toBe(true);
  });
});

describe('typing wins', () => {
  it('is inert inside an input, textarea, select or contenteditable', () => {
    const cases = ['input', 'textarea', 'select'];
    for (const tag of cases) {
      const element = document.createElement(tag);
      expect(isTypingContext(element), tag).toBe(true);
    }

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', '');
    expect(isTypingContext(editable)).toBe(true);

    // A child of an editable host, which is where focus usually lands.
    const child = document.createElement('span');
    editable.append(child);
    expect(isTypingContext(child)).toBe(true);
  });

  it('is live outside one', () => {
    expect(isTypingContext(document.createElement('div'))).toBe(false);
    expect(isTypingContext(document.createElement('button'))).toBe(false);
    expect(isTypingContext(null)).toBe(false);
  });

  it('does not treat contenteditable="false" as typing', () => {
    const element = document.createElement('div');
    element.setAttribute('contenteditable', 'false');

    expect(isTypingContext(element)).toBe(false);
  });
});
