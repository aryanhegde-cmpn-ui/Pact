import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { markAllRead, markRead, readInbox } from '@/lib/notifications/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reading the inbox is what delivers anything now due -- there is no scheduler. */
export const GET = requireCapability('progress:read', async (actor) => {
  {
    return jsonOk(await readInbox(actor.ownerId));
  }
});

export const POST = requireCapability('progress:read', async (actor, request) => {
  {
    const body = (await readJson(request)) as { ids?: string[]; all?: boolean };

    const updated = body.all
      ? await markAllRead(actor.ownerId)
      : await markRead(body.ids ?? [], actor.ownerId);
    return jsonOk({ read: updated });
  }
});
