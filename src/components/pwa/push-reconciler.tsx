'use client';

import { useEffect } from 'react';

import { reconcileSubscription } from './push-subscription';

/**
 * Reconciles this browser's push subscription with the server on app load.
 *
 * Renders nothing. It exists because a browser can rotate or drop a push
 * subscription without telling anyone: the server keeps sending to a dead
 * endpoint, the push service accepts it, and nothing arrives -- with no error
 * on either side. Checking on load is the only thing that catches it.
 */
export function PushReconciler({ publicKey }: { publicKey?: string }): null {
  useEffect(() => {
    // Deferred a tick so the effect itself performs no work synchronously, and
    // so it cannot delay first paint.
    const timer = setTimeout(() => void reconcileSubscription(publicKey), 0);

    return () => clearTimeout(timer);
  }, [publicKey]);

  return null;
}
