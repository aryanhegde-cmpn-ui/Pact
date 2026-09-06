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
  }
}
