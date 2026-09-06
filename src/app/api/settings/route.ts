import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings, updateSettings } from '@/lib/notifications/settings';
import { updateSettingsSchema } from '@/lib/schemas/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('settings:read', async (actor) => {
  {
    await connectToDatabase();
    return jsonOk(await getSettings(actor.ownerId));
  }
});

export const PATCH = requireCapability('settings:write', async (actor, request) => {
  {
    const input = updateSettingsSchema.parse(await readJson(request));
    await connectToDatabase();

    return jsonOk(await updateSettings(input, actor.ownerId));
  }
});
