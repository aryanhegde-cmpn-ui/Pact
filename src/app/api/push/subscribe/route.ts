import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { PushSubscriptionModel } from '@/lib/db/models/push-subscription';
import { connectToDatabase } from '@/lib/db/mongoose';
import { registerSubscriptionSchema } from '@/lib/schemas/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The endpoints this user currently has registered. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    await connectToDatabase();
    const rows = await PushSubscriptionModel.find({ userId: session.user.id }).lean();

    return jsonOk({
      subscriptions: rows.map((row) => ({
        id: String(row._id),
        // The endpoint is a capability URL: anyone holding it can push to the
        // device. Only the tail is returned, which is enough to match against
        // the browser's current subscription without shipping the whole thing.
        endpointTail: row.endpoint.slice(-24),
        userAgent: row.userAgent ?? '',
        createdAt: row.createdAt.toISOString(),
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        failureCount: row.failureCount,
      })),
    });
  } catch (error) {
    return translateError(error);
  }
}

/**
 * Registers or refreshes a subscription.
 *
 * Upserted on `endpoint`: a browser re-registering the same endpoint updates
 * the existing row rather than accumulating duplicates that would each receive
 * their own copy of every notification.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const input = registerSubscriptionSchema.parse(await readJson(request));
    await connectToDatabase();

    await PushSubscriptionModel.updateOne(
      { endpoint: input.endpoint },
      {
        $set: {
          userId: session.user.id,
          keys: input.keys,
          userAgent: (input.userAgent ?? '').slice(0, 500),
          // A re-registration is evidence the endpoint is alive, so the
          // failure history that would have deleted it is cleared.
          failureCount: 0,
          lastFailureReason: null,
        },
        $setOnInsert: { createdAt: new Date(), lastSuccessAt: null },
      },
      { upsert: true },
    );

    return jsonOk({ registered: true });
  } catch (error) {
    return translateError(error);
  }
}

/** Removes a subscription. Used by the device list and by the client on unsubscribe. */
export async function DELETE(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const body = (await readJson(request)) as { endpoint?: string; id?: string };
    await connectToDatabase();

    const filter = body.endpoint
      ? { endpoint: body.endpoint, userId: session.user.id }
      : { _id: body.id, userId: session.user.id };

    const result = await PushSubscriptionModel.deleteOne(filter);
    return jsonOk({ deleted: result.deletedCount ?? 0 });
  } catch (error) {
    return translateError(error);
  }
}
