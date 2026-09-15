// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecoveryCodesSection } from './recovery-codes-section';

/**
 * The settings panel: a count, a warning, and one destructive action.
 *
 * The confirmation is not ceremony. Regenerating invalidates every code already
 * written down, so somebody who clicks it and closes the tab without copying
 * the new set has locked themselves out more thoroughly than before.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(codes: string[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ codes }),
  })) as unknown as ReturnType<typeof vi.fn>;
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

describe('the count', () => {
  it('states how many are left', () => {
    render(<RecoveryCodesSection remaining={7} />);

    expect(screen.getByText(/codes left/)).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('warns below three', () => {
    render(<RecoveryCodesSection remaining={2} />);

    expect(screen.getByText(/Generate a new set before you run out/)).toBeTruthy();
  });

  it('does not warn at three', () => {
    // The watermark is "below three", not "three or fewer" -- a warning that
    // fires early is one that gets read as decoration.
    render(<RecoveryCodesSection remaining={3} />);

    expect(screen.queryByText(/before you run out/)).toBeNull();
  });

  it('offers generation rather than regeneration when there are none', () => {
    render(<RecoveryCodesSection remaining={0} />);

    expect(screen.getByRole('button', { name: 'Generate codes' })).toBeTruthy();
  });
});

describe('regenerating', () => {
  it('asks first, and says what will be lost', () => {
    const fetchMock = stubFetch([]);
    render(<RecoveryCodesSection remaining={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate codes' }));

    expect(screen.getByText(/invalidates all 10 of your current codes/)).toBeTruthy();
    // Nothing has happened yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing on cancel', () => {
    const fetchMock = stubFetch([]);
    render(<RecoveryCodesSection remaining={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/invalidates all/)).toBeNull();
  });

  it('shows the new set once, and only after confirming', async () => {
    const codes = ['A2B3C-D4E5F', 'G6H7J-K8M9N'];
    const fetchMock = stubFetch(codes);
    render(<RecoveryCodesSection remaining={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate codes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate a new set' }));

    await waitFor(() => expect(screen.getByLabelText('Recovery codes')).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledWith('/api/recovery/codes', { method: 'POST' });
    expect((screen.getByLabelText('Recovery codes') as HTMLTextAreaElement).value).toBe(
      codes.join('\n'),
    );
    expect(screen.getByText(/only time these are shown/i)).toBeTruthy();
  });
});
