/**
 * Pact's external per-minute tick.
 *
 * Deliberately contains NO logic. It POSTs to Pact's dispatch endpoint with a
 * shared secret and reports what came back. Every decision about what to send,
 * when, and to whom lives in Pact.
 *
 * That is the point: the scheduler is a commodity and must stay swappable. If
 * Cloudflare becomes inconvenient, cron-job.org or a cron line on any machine
 * can replace this without touching the app. See README.md.
 */
export interface Env {
  /** Pact's origin, e.g. https://pact.vercel.app */
  PACT_URL: string;
  /** Must match Pact's CRON_SECRET. Set with `wrangler secret put`. */
  CRON_SECRET: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },

  /**
   * Also reachable over HTTP, so the tick can be exercised by hand while
   * debugging. Cron failures are invisible otherwise -- Cloudflare does not
   * retry them and raises no alert.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/tick') {
      return new Response('Pact tick. POST /tick to run one manually.', { status: 200 });
    }

    const result = await tick(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;

async function tick(
  env: Env,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  try {
    const response = await fetch(`${env.PACT_URL}/api/notifications/dispatch`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });

    const body = await response.json().catch(() => null);

    // Logged rather than retried. Dispatch is a queue scan, so the next tick
    // picks up whatever this one missed -- retrying here would only risk two
    // overlapping invocations, which the endpoint already handles but which
    // buys nothing.
    if (!response.ok) {
      console.error(`dispatch failed: ${response.status}`, body);
      return { ok: false, status: response.status, body };
    }

    console.log('dispatch', JSON.stringify(body));
    return { ok: true, status: response.status, body };
  } catch (error) {
    console.error('dispatch unreachable', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
