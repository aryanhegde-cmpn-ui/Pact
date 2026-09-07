// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortcutProvider } from './shortcut-provider';

/**
 * The keyboard layer, exercised where it matters: the cases where it must NOT
 * fire.
 *
 * A shortcut that works is easy. A shortcut that stays out of the way while
 * someone types an outcome, and while a focus session is running, is the whole
 * of the risk.
 */
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  push.mockClear();
  document.body.innerHTML = '';
});

function press(key: string, target: Element = document.body): void {
  fireEvent.keyDown(target, { key });
}

describe('sequences navigate', () => {
  it('goes to Today on g then t', () => {
    render(<ShortcutProvider />);

    press('g');
    press('t');

    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('does nothing on a prefix alone', () => {
    render(<ShortcutProvider />);

    press('g');

    expect(push).not.toHaveBeenCalled();
  });

  it('forgets the prefix after an unbound second key', () => {
    render(<ShortcutProvider />);

    press('g');
    press('z');
    press('t');

    // `t` on its own is not a binding, and the sequence was already spent.
    expect(push).not.toHaveBeenCalled();
  });
});

describe('single keys act on what is on screen', () => {
  it('clicks the element carrying the target attribute', () => {
    const clicked = vi.fn();
    const button = document.createElement('button');
    button.dataset.shortcut = 'start-next';
    button.addEventListener('click', clicked);
    document.body.append(button);

    render(<ShortcutProvider />);
    press('s');

    expect(clicked).toHaveBeenCalledOnce();
  });

  it('does nothing when the target is not on this screen', () => {
    // Pressing 2 on the settings page must not start a block, and cannot,
    // because there is nothing there to activate.
    render(<ShortcutProvider />);

    expect(() => press('2')).not.toThrow();
    expect(push).not.toHaveBeenCalled();
  });

  it('focuses rather than clicks a focus target', () => {
    const input = document.createElement('input');
    input.dataset.shortcut = 'filter';
    document.body.append(input);

    render(<ShortcutProvider />);
    press('/');

    expect(document.activeElement).toBe(input);
  });
});

describe('typing wins, always', () => {
  it('ignores every single key while an input has focus', () => {
    const clicked = vi.fn();
    const button = document.createElement('button');
    button.dataset.shortcut = 'new-commitment';
    button.addEventListener('click', clicked);
    document.body.append(button);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    render(<ShortcutProvider />);

    // "n" is the new-commitment binding; typed into a field it is a letter.
    press('n', input);
    press('1', input);
    press('/', input);

    expect(clicked).not.toHaveBeenCalled();
  });

  it('ignores a sequence typed into a textarea', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    render(<ShortcutProvider />);
    press('g', textarea);
    press('t', textarea);

    expect(push).not.toHaveBeenCalled();
  });

  it('leaves modifier combinations to the browser', () => {
    render(<ShortcutProvider />);

    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'g', metaKey: true });

    expect(push).not.toHaveBeenCalled();
  });
});

describe('a running session silences everything but Escape', () => {
  it('fires no navigation and no action', () => {
    const clicked = vi.fn();
    const button = document.createElement('button');
    button.dataset.shortcut = 'start-next';
    button.addEventListener('click', clicked);
    document.body.append(button);

    render(<ShortcutProvider sessionRunning />);

    press('g');
    press('t');
    press('s');
    press('n');

    /**
     * The server already refuses `commitment:write` during a session. A
     * keyboard offering the same actions would be a faster way to collect a
     * 409, and a shortcut that navigates out of a session is a shortcut out of
     * the work.
     */
    expect(push).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('still opens nothing on ?', () => {
    render(<ShortcutProvider sessionRunning />);
    press('?');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the help sheet', () => {
  it('opens on ? and lists every binding', () => {
    render(<ShortcutProvider />);
    press('?');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Today');
    expect(dialog.textContent).toContain('New commitment');
    expect(dialog.textContent).toContain('Close a dialog or sheet');
  });

  it('closes on Escape', () => {
    render(<ShortcutProvider />);
    press('?');
    expect(screen.getByRole('dialog')).toBeTruthy();

    press('Escape');

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('swallows other keys while it is open', () => {
    render(<ShortcutProvider />);
    press('?');

    press('g');
    press('t');

    expect(push).not.toHaveBeenCalled();
  });
});

describe('focus is trapped in the sheet and restored after it', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<ShortcutProvider />);
    press('?');

    const dialog = screen.getByRole('dialog');

    // Focus inside, or the reader is left behind on the page underneath with
    // no way to reach what just appeared.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('wraps Tab at the end and Shift+Tab at the start', () => {
    render(<ShortcutProvider />);
    press('?');

    const dialog = screen.getByRole('dialog');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], [tabindex]')];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('puts focus back where it was when it closes', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'somewhere on the page';
    document.body.append(trigger);
    trigger.focus();

    render(<ShortcutProvider />);
    press('?');
    expect(document.activeElement).not.toBe(trigger);

    press('Escape');

    /**
     * Without this, focus falls to `document.body` and the next Tab starts
     * again from the top of the page -- which loses a keyboard user's place
     * completely, every time they check the shortcut list.
     */
    expect(document.activeElement).toBe(trigger);
  });
});
