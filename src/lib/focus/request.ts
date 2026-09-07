import 'server-only';

import { cache } from 'react';

import { getActiveSession, type ActiveSession } from '@/lib/focus/service';

/**
 * The running session for this request, looked up once.
 *
 * `cache` dedupes within a single render pass, the same way
 * `recoveryForRequest` does: the shell layout needs it to decide whether the
 * keyboard layer is live, and a page under it may need it too. Without this
 * every render that asked would cost its own round trip, and on an M0 cluster
 * the per-request query count is the budget that matters.
 */
export const sessionForRequest = cache(async (ownerId: string): Promise<ActiveSession | null> =>
  getActiveSession(ownerId),
);
