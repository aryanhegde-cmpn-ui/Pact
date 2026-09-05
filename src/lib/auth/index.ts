import 'server-only';

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { authorizeCredentials } from '@/lib/auth/authorize';
import { authConfig } from '@/lib/auth/config';

export { GENERIC_AUTH_ERROR, authorizeCredentials } from '@/lib/auth/authorize';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: (credentials) => authorizeCredentials(credentials),
    }),
  ],
});
