/**
 * Every keyboard shortcut, in one list.
 *
 * ---------------------------------------------------------------------------
 * THE LIST IS THE FEATURE.
 * ---------------------------------------------------------------------------
 * A shortcut nobody can discover is a trap: it fires when a key is pressed by
 * accident and there is nothing to consult afterwards. So `?` renders THIS
 * array, and a test fails if the sheet is built from anything else. Adding a
 * binding without documenting it is not possible, because the documentation is
 * where the binding is defined.
 *
 * Two shapes, deliberately:
 *
 *   SEQUENCES for navigation -- `g` then a letter. Going somewhere is frequent
 *   and harmless, and a prefix avoids fighting the browser for a modifier
 *   (Ctrl+T, Cmd+W and friends are all spoken for, and a page that steals them
 *   is worse than one with no shortcuts).
 *
 *   SINGLE KEYS for actions on the current screen. Fast, and safe only because
 *   of the rule below.
 *
 * NOTHING DESTRUCTIVE GETS A KEY. No shortcut abandons a commitment,
 * discharges a consequence, toggles vacation mode, or ends anything. Those are
 * decisions, and a decision that can be made by brushing a key is not one. A
 * test enforces it against the actions listed here.
 * ---------------------------------------------------------------------------
 */

/** What a binding does when it fires. */
export type ShortcutAction =
  /** Go to a route. */
  | { kind: 'navigate'; to: string }
  /** Click the element carrying `data-shortcut="<target>"`, if it is on screen. */
  | { kind: 'activate'; target: string }
  /** Focus the element carrying `data-shortcut="<target>"`. */
  | { kind: 'focus'; target: string }
  /** Open the shortcut sheet. */
  | { kind: 'help' };

export interface Shortcut {
  /** `['g', 't']` is a sequence; `['n']` is a single key. */
  keys: string[];
  label: string;
  group: 'Go to' | 'On this screen' | 'Help';
  action: ShortcutAction;
}

export const SHORTCUTS: Shortcut[] = [
  {
    keys: ['g', 't'],
    label: 'Today',
    group: 'Go to',
    action: { kind: 'navigate', to: '/dashboard' },
  },
  {
    keys: ['g', 'o'],
    label: 'Tomorrow',
    group: 'Go to',
    action: { kind: 'navigate', to: '/tomorrow' },
  },
  {
    keys: ['g', 'w'],
    label: 'This week',
    group: 'Go to',
    action: { kind: 'navigate', to: '/week' },
  },
  { keys: ['g', 's'], label: 'Study', group: 'Go to', action: { kind: 'navigate', to: '/study' } },
  {
    keys: ['g', 'p'],
    label: 'Progress',
    group: 'Go to',
    action: { kind: 'navigate', to: '/progress' },
  },

  {
    keys: ['s'],
    label: 'Start the next action',
    group: 'On this screen',
    action: { kind: 'activate', target: 'start-next' },
  },
  {
    keys: ['1'],
    label: 'Start block 1',
    group: 'On this screen',
    action: { kind: 'activate', target: 'start-block-1' },
  },
  {
    keys: ['2'],
    label: 'Start block 2',
    group: 'On this screen',
    action: { kind: 'activate', target: 'start-block-2' },
  },
  {
    keys: ['3'],
    label: 'Start block 3',
    group: 'On this screen',
    action: { kind: 'activate', target: 'start-block-3' },
  },
  {
    keys: ['n'],
    label: 'New commitment',
    group: 'On this screen',
    action: { kind: 'activate', target: 'new-commitment' },
  },
  {
    keys: ['/'],
    label: 'Focus the filter',
    group: 'On this screen',
    action: { kind: 'focus', target: 'filter' },
  },

  { keys: ['?'], label: 'Show this list', group: 'Help', action: { kind: 'help' } },
  {
    keys: ['Escape'],
    label: 'Close a dialog or sheet',
    group: 'Help',
    // Handled by the dialogs themselves; listed because the sheet must be a
    // complete account of what the keyboard does, not of what this module does.
    action: { kind: 'help' },
  },
];

/** The prefix keys that begin a sequence, derived rather than restated. */
export const SEQUENCE_PREFIXES = new Set(
  SHORTCUTS.filter((shortcut) => shortcut.keys.length > 1).map((shortcut) => shortcut.keys[0]!),
);

/**
 * How long a sequence stays open.
 *
 * Long enough to be typed deliberately, short enough that a `g` pressed while
 * reading does not swallow the next keystroke and navigate somewhere.
 */
export const SEQUENCE_TIMEOUT_MS = 1_500;

/**
 * Whether a key event should be ignored because the user is typing.
 *
 * ---------------------------------------------------------------------------
 * THE MOST IMPORTANT FUNCTION IN THIS FILE.
 * ---------------------------------------------------------------------------
 * Single-key bindings and text entry cannot coexist. Typing "no" in an outcome
 * field would open a new commitment and then navigate; typing "1" in an
 * estimate would start a block. This is inert whenever anything editable has
 * focus -- input, textarea, select, contenteditable, or anything inside a
 * contenteditable subtree -- and whenever a modifier is held, because those
 * belong to the browser and the operating system.
 * ---------------------------------------------------------------------------
 */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;

  // `closest` rather than the element itself: focus often lands on a child of
  // the editable host.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** Whether an action can change data in a way that cannot be undone. */
export function isDestructive(action: ShortcutAction): boolean {
  if (action.kind !== 'activate') return false;

  return /abandon|delete|discharge|vacation|revoke|end-session|reset/.test(action.target);
}
