// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RecoveryCodesPanel } from './codes-panel';

/**
 * The codes screen is a gate, not a notification.
 *
 * An account created without its codes saved has no way back in -- there is no
 * reset email, and an overseer cannot ask the primary to run a script for them.
 * So where this panel gates a flow, the only way past it is the
 * acknowledgement: no skip, no "remind me later", and no route that reads the
 * codes back afterwards.
 */
const CODES = ['A2B3C-D4E5F', 'G6H7J-K8M9N', 'P2Q3R-S4T5V'];

describe('as a gate', () => {
  it('will not continue until the box is ticked', () => {
    const onAcknowledged = vi.fn();
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={onAcknowledged} />);

    // Plain DOM assertions: this project does not load jest-dom's matchers.
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // Even clicking it does nothing, so the disabled attribute is not the only
    // thing standing between a user and an account with no recovery path.
    fireEvent.click(button);
    expect(onAcknowledged).not.toHaveBeenCalled();
  });

  it('continues once it is', () => {
    const onAcknowledged = vi.fn();
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={onAcknowledged} />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onAcknowledged).toHaveBeenCalledOnce();
  });

  it('offers no way around the acknowledgement', () => {
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={vi.fn()} />);

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels).not.toContain('Skip');
    expect(labels.join(' ')).not.toMatch(/later|skip|dismiss/i);
  });
});

describe('what it shows', () => {
  it('warns that this is the only time', () => {
    render(<RecoveryCodesPanel codes={CODES} />);

    expect(screen.getByText(/only time these are shown/i)).toBeTruthy();
  });

  it('renders every code as one copyable block', () => {
    render(<RecoveryCodesPanel codes={CODES} />);

    // One field holding all of them: ten separate copy buttons is ten chances
    // to paste nine, and a password manager takes a block.
    const field = screen.getByLabelText('Recovery codes') as HTMLTextAreaElement;
    expect(field.value).toBe(CODES.join('\n'));
    expect(field.readOnly).toBe(true);
  });

  it('is informational when nothing is gated on it', () => {
    render(<RecoveryCodesPanel codes={CODES} />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});
