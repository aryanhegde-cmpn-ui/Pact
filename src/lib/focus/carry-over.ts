import 'server-only';

import { FocusSessionModel } from '@/lib/db/models/focus-session';

/**
 * Topics carried over by a session that ran out of time.
 *
 * Read by the curriculum's suggestion so that a block whose work is genuinely
 * unfinished picks it back up tomorrow rather than moving on to new material.
 * Bounded to recent sessions: a topic left in progress in July is not what
 * today's block is continuing.
 */
export async function carriedOverTopics(
  ownerId: string,
  since: Date,
): Promise<Map<string, string>> {
  const rows = await FocusSessionModel.find({
    ownerId,
    outcome: 'more-time',
    topicKey: { $ne: null },
    endedAt: { $gte: since },
  })
    .sort({ endedAt: -1 })
    .limit(20)
    .lean();

  const byBlock = new Map<string, string>();
  for (const row of rows) {
    if (!row.blockId || !row.topicKey) continue;
    // Most recent wins: the sort is newest first and the first write stands.
    if (!byBlock.has(row.blockId)) byBlock.set(row.blockId, row.topicKey);
  }

  return byBlock;
}
