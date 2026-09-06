import { auth } from '@/lib/auth';
import { jsonError, jsonOk, translateError } from '@/lib/api/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { isPushConfigured, sendToUser } from '@/lib/notifications/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends a test push to every registered device.
 *
 * Exists because it is the first thing anyone reaches for when push appears
 * broken, and it distinguishes the failure modes that otherwise look
 * identical: no VAPID keys, no subscriptions, or subscriptions that the push
 * service rejects. The response says which.
 */
export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    if (!isPushConfigured()) {
      return jsonOk({
        ok: false,
        reason: 'not-configured',
        message:
          'VAPID keys are not set. Run `npm run vapid:generate` and set ' +
          'NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.',
      });
    }

    await connectToDatabase();

    const report = await sendToUser(session.user.id, {
      notificationId: 'test',
      commitmentId: null,
      type: 'TEST',
      title: 'Pact',
      body: 'Test notification. Push is working.',
      // Distinct tag so a test never replaces a real notification.
      tag: 'pact:test',
      url: '/dashboard',
    });

    if (report.attempted === 0) {
      return jsonOk({
        ok: false,
        reason: 'no-subscriptions',
        message:
          'No devices are registered. Enable notifications on this device first — ' +
          'on iOS that only works from the installed app.',
      });
    }

    return jsonOk({
      ok: report.sent > 0,
      reason: report.sent > 0 ? 'sent' : 'all-failed',
      ...report,
    });
  } catch (error) {
    return translateError(error);
  }
}
