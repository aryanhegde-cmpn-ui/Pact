export const metadata = { title: 'Offline' };

/**
 * The last-resort offline page.
 *
 * Only reached when the shell cache has nothing for the requested route.
 * Normally the cached dashboard renders instead, with its staleness banner --
 * this exists so a cold navigation offline is not a browser error page.
 */
export default function OfflinePage(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center px-md py-xl">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold tracking-tight">Offline</h1>
        <p className="text-text/60 mt-sm text-sm">
          Pact cannot reach the server. Anything you have already opened is still available; this
          page was not.
        </p>
        <a
          href="/dashboard"
          className="border-edge mt-lg inline-flex min-h-11 items-center rounded border px-md text-sm"
        >
          Back to today
        </a>
      </div>
    </main>
  );
}
