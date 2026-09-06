import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings, updateSettings } from '@/lib/notifications/settings';
import { updateSettingsSchema } from '@/lib/schemas/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    await connectToDatabase();
    return jsonOk(await getSettings());
  } catch (error) {
    return translateError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const input = updateSettingsSchema.parse(await readJson(request));
    await connectToDatabase();

    return jsonOk(await updateSettings(input));
  } catch (error) {
    return translateError(error);
  }
}
