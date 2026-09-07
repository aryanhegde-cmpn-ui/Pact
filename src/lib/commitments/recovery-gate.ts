import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { getRecoveryState, type RecoveryState } from '@/lib/commitments/recovery';

/**
 * Which surfaces recovery mode takes away, and how.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT ONLY THE DASHBOARD.
 * ---------------------------------------------------------------------------
 * The point of recovery mode is to remove the places where a backlog turns
 * into a bigger plan. The dashboard is one of them; the study planner is the
 * other, and arguably the worse one -- it is a whole surface for deciding what
 * to do next, offered to someone who has thirty-four things they already said
 * they would do. Postponements goes too: it is a list of deadlines that have
 * moved, and reading it while behind invites moving more of them.
 *
 * SETTINGS STAYS REACHABLE, deliberately. Locking someone out of settings
 * during a restrictive state is how they get stuck in it -- no way to change
 * quiet hours, no way to end an overseer arrangement, no way out except
 * finishing work they are already failing to finish. A restrictive state with
 * no escape hatch is a trap, not a tool.
 * ---------------------------------------------------------------------------
 */
export const RECOVERY_GATED_PATHS = ['/study', '/postponements'] as const;

export const RECOVERY_REACHABLE_PATHS = ['/settings'] as const;

export function isGatedDuringRecovery(pathname: string): boolean {
  return RECOVERY_GATED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Recovery state for this request, computed once.
 *
 * `cache` dedupes within a single render pass, so the shell layout deciding
 * which tabs to show and the page deciding whether to render at all share one
 * aggregation rather than each running their own. Without it, every gated page
 * would cost two.
 */
export const recoveryForRequest = cache(async (ownerId: string): Promise<RecoveryState> =>
  getRecoveryState(ownerId),
);

/**
 * Sends a gated surface back to the dashboard while recovery is active.
 *
 * A redirect rather than a rendered explanation: an explanation on `/study` is
 * still a page you can sit on, and the whole point is that there is one thing
 * to do. The dashboard says why.
 */
export async function gateDuringRecovery(ownerId: string): Promise<void> {
  const recovery = await recoveryForRequest(ownerId);
  if (recovery.active) redirect('/dashboard');
}
