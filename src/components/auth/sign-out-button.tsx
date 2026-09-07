'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';

export function SignOutButton(): React.JSX.Element {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ redirectTo: '/' });
      }}
      className="border-edge text-text/70 hover:border-signal hover:text-text inline-flex min-h-11 items-center rounded border px-sm text-sm transition-colors disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
