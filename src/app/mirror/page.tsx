/** Read-only display surface. Rendered outside the app shell, by design. */
export default function MirrorPage() {
  return (
    <div className="flex min-h-dvh flex-col justify-between p-xl lg:p-2xl">
      <header>
        <p className="text-text/40 text-sm tracking-[0.2em] uppercase">Pact</p>
      </header>

      <div>
        <p className="text-3xl leading-tight font-medium">Nothing to display.</p>
        <p className="text-text/50 mt-sm text-lg">Waiting on a data source.</p>
      </div>

      <footer className="text-text/30 text-xs">Read-only display</footer>
    </div>
  );
}
