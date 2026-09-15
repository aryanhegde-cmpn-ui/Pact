import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    role?: string;
    username?: string;
    /** The primary whose data this account may touch. */
    ownerId?: string;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      username?: string;
      role: string;
      /** Every scoped query filters on this. */
      ownerId?: string;
      /**
       * When this session was signed in, in epoch milliseconds.
       *
       * Deliberately NOT the JWT's own `iat`: Auth.js re-issues the token
       * daily under `updateAge`, which mints a fresh `iat` and would let an
       * invalidated session quietly become valid again a day later. This is
       * stamped once, on the sign-in pass, and carried forward unchanged.
       */
      signedInAt?: number;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    displayName?: string | null;
    username?: string;
    role?: string;
    ownerId?: string;
    /** Stamped on the sign-in pass only. Never refreshed. */
    signedInAt?: number;
  }
}
