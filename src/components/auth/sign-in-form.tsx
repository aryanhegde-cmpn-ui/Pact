'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { safeReturnTo } from '@/lib/auth/return-to';

/**
 * Sign-in form.
 *
 * Every failure renders the same message. Wrong password, unknown email and a
 * locked account are indistinguishable here because they are indistinguishable
 * on the server -- see GENERIC_AUTH_ERROR in src/lib/auth.
 */
const GENERIC_ERROR = 'Username or password is incorrect.';

interface FieldErrors {
  identifier?: string;
  password?: string;
}

export function SignInForm({ returnTo }: { returnTo?: string }): React.JSX.Element {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    // Only "is it empty". The shape is NOT validated here: rejecting a
    // malformed identifier client-side would tell an attacker which forms are
    // even considered, and the server treats every failure identically anyway.
    if (!identifier.trim()) errors.identifier = 'Enter your username or email.';
    if (!password) errors.password = 'Enter your password.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await signIn('credentials', {
        identifier: identifier.trim(),
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setFormError(GENERIC_ERROR);
        setPassword('');
        return;
      }

      // Re-validated here rather than trusted from props: this value came off
      // the query string, and the same rule has to hold on both sides.
      router.push(safeReturnTo(returnTo));
      router.refresh();
    } catch {
      setFormError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <label htmlFor="identifier" className="text-sm text-text/70">
          Username or email
        </label>
        <input
          id="identifier"
          name="identifier"
          // `text`, not `email`: the browser would otherwise reject a perfectly
          // valid username before the form is submitted.
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          aria-invalid={Boolean(fieldErrors.identifier)}
          aria-describedby={fieldErrors.identifier ? 'identifier-error' : undefined}
          className="border-edge bg-surface text-text focus:border-signal min-h-11 rounded border px-md outline-none disabled:opacity-50"
          disabled={submitting}
        />
        {fieldErrors.identifier ? (
          <p id="identifier-error" className="text-signal text-sm">
            {fieldErrors.identifier}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-xs">
        <label htmlFor="password" className="text-sm text-text/70">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          className="border-edge bg-surface text-text focus:border-signal min-h-11 rounded border px-md outline-none disabled:opacity-50"
          disabled={submitting}
        />
        {fieldErrors.password ? (
          <p id="password-error" className="text-sm text-signal">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      {formError ? (
        // A left rule, like every other annotation in the app. A tinted panel
        // would be a second thing drawn in the accent on a page that already
        // has one -- the button.
        <p role="alert" className="border-signal text-signal border-l-2 pl-md text-sm">
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="bg-signal text-on-signal mt-sm min-h-14 rounded px-md font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
