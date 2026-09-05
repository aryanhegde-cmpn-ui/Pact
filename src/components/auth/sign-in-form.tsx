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
const GENERIC_ERROR = 'Email or password is incorrect.';

interface FieldErrors {
  email?: string;
  password?: string;
}

export function SignInForm({ returnTo }: { returnTo?: string }): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = 'That does not look like an email address.';
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
        email: email.trim(),
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
        <label htmlFor="email" className="text-sm text-text/70">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          className="rounded border border-edge bg-surface px-md py-sm text-text outline-none focus:border-signal disabled:opacity-50"
          disabled={submitting}
        />
        {fieldErrors.email ? (
          <p id="email-error" className="text-sm text-signal">
            {fieldErrors.email}
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
          className="rounded border border-edge bg-surface px-md py-sm text-text outline-none focus:border-signal disabled:opacity-50"
          disabled={submitting}
        />
        {fieldErrors.password ? (
          <p id="password-error" className="text-sm text-signal">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          role="alert"
          className="rounded border border-signal/40 bg-signal/10 px-md py-sm text-sm text-signal"
        >
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-signal px-md py-sm font-medium text-[color:var(--pact-base)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
