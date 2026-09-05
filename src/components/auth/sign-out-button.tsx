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
      className="rounded border border-edge px-sm py-xs text-sm text-text/70 transition-colors hover:border-signal hover:text-text disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
