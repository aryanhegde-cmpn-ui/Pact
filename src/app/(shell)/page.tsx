import Link from 'next/link';

/**
 * Landing surface and sign-in entry point. Google sign-in arrives in the next
 * PR; the button is intentionally inert for now.
 */
export default function LandingPage() {
  return (
    <div className="max-w-2xl py-xl">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">Pact</h1>

      <p className="text-text/70 mt-md text-base">
        Google Tasks holds what you said you would do. This holds whether you actually did it.
      </p>

      <div className="mt-xl">
        <button
          type="button"
          disabled
          className="border-edge bg-surface text-text/40 rounded-md border px-lg py-sm text-sm"
        >
          Sign in with Google
        </button>
        <p className="text-text/40 mt-xs text-xs">Authentication lands in the next change.</p>
      </div>

      <p className="text-text/50 mt-2xl text-sm">
        <Link href="/dashboard" className="hover:text-text underline underline-offset-4">
          Dashboard
        </Link>
      </p>
    </div>
  );
}
