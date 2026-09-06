import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { hashPassword } from '@/lib/auth/password';
import { RelationshipModel } from '@/lib/db/models/relationship';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { emailSchema, normaliseUsername, passwordSchema, usernameSchema } from '@/lib/schemas/user';

/** How long an invite stays redeemable. */
export const INVITE_TTL_DAYS = 7;

export class RelationshipError extends Error {
  override readonly name = 'RelationshipError';
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Tokens are stored hashed.
 *
 * An invite is a bearer credential: whoever holds it can create an account with
 * read access to the primary's entire record. A database dump should not hand
 * that over, so only the digest is kept — the same reasoning as a password.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Invite {
  /** Shown once. Only the hash is stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Creates a single-use invite.
 *
 * There is no open registration and there should not be: the only way a second
 * account comes into existence is a primary deliberately inviting one.
 */
export async function createInvite(primaryUserId: string, now: Date = new Date()): Promise<Invite> {
  await connectToDatabase();

  const existing = await RelationshipModel.findOne({
    primaryUserId,
    status: { $in: ['pending', 'active'] },
  }).lean();

  if (existing?.status === 'active') {
    throw new RelationshipError('An overseer is already active. Revoke them first.', 409);
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Replaces any outstanding pending invite: two live invites for one
  // relationship is two ways in, and only one of them is remembered.
  await RelationshipModel.updateOne(
    { primaryUserId, status: 'pending' },
    {
      $set: { inviteTokenHash: hashToken(token), inviteExpiresAt: expiresAt, status: 'pending' },
      $setOnInsert: { primaryUserId, createdAt: now, overseerUserId: null },
    },
    { upsert: true },
  );

  return { token, expiresAt };
}

export interface RedeemInput {
  token: string;
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Redeems an invite, creating the overseer account.
 *
 * The invite is consumed ATOMICALLY — a conditional update that matches only a
 * still-pending row with this token hash. Read-then-write would let two
 * concurrent redemptions both see "pending" and both create an account, and
 * the second would silently overwrite the first's relationship.
 */
export async function redeemInvite(
  input: RedeemInput,
  now: Date = new Date(),
): Promise<{ overseerUserId: string; primaryUserId: string }> {
  await connectToDatabase();

  const username = usernameSchema.parse(input.username);
  const email = emailSchema.parse(input.email);
  const password = passwordSchema.parse(input.password);

  const tokenHash = hashToken(input.token);

  /**
   * Claim first, create second.
   *
   * The relationship row is the lock. If the claim fails, nothing was created,
   * so a losing race leaves no orphan account. Creating the user first and
   * claiming after would leave a dangling account when the claim lost.
   */
  const claimed = await RelationshipModel.findOneAndUpdate(
    {
      inviteTokenHash: tokenHash,
      status: 'pending',
      inviteExpiresAt: { $gt: now },
    },
    { $set: { status: 'active', redeemedAt: now, inviteTokenHash: null } },
    { returnDocument: 'after' },
  ).lean();

  if (!claimed) {
    // Deliberately one message for expired, already-used and never-existed. An
    // invite token is a secret, and distinguishing them tells a guesser which
    // guesses are close.
    throw new RelationshipError('That invite is not valid.', 400);
  }

  try {
    const overseer = await UserModel.create({
      email,
      username,
      usernameLower: normaliseUsername(username),
      passwordHash: await hashPassword(password),
      displayName: input.displayName?.trim() || username,
      role: 'overseer',
      // An overseer is scoped to the primary who invited them. Every query
      // they make filters on this.
      ownerId: claimed.primaryUserId,
      createdAt: now,
      lastLoginAt: null,
    });

    await RelationshipModel.updateOne(
      { _id: claimed._id },
      { $set: { overseerUserId: String(overseer._id) } },
    );

    return { overseerUserId: String(overseer._id), primaryUserId: claimed.primaryUserId };
  } catch (error) {
    // The account could not be created (a duplicate username, say). Put the
    // invite back rather than burning it -- otherwise a typo costs the primary
    // a whole invite cycle.
    await RelationshipModel.updateOne(
      { _id: claimed._id },
      { $set: { status: 'pending', redeemedAt: null, inviteTokenHash: tokenHash } },
    );
    throw error;
  }
}

/**
 * Ends the arrangement.
 *
 * Sets `revoked`, never deletes. "You had an overseer for six weeks and then
 * removed them" is a fact worth keeping, and a deleted row erases it.
 *
 * Takes effect on the overseer's NEXT request, because the guard re-reads the
 * relationship per request rather than trusting the session — a 90-day JWT
 * issued before revocation would otherwise keep working, which is not a
 * revocation at all.
 */
export async function revokeRelationship(
  primaryUserId: string,
  now: Date = new Date(),
): Promise<{ revoked: boolean }> {
  await connectToDatabase();

  const result = await RelationshipModel.updateOne(
    { primaryUserId, status: { $in: ['pending', 'active'] } },
    { $set: { status: 'revoked', revokedAt: now, inviteTokenHash: null } },
  );

  return { revoked: (result.modifiedCount ?? 0) > 0 };
}

export interface RelationshipView {
  status: 'none' | 'pending' | 'active' | 'revoked';
  overseerUsername: string | null;
  createdAt: string | null;
  inviteExpiresAt: string | null;
  revokedAt: string | null;
}

/** The primary's view of their arrangement. */
export async function describeRelationship(primaryUserId: string): Promise<RelationshipView> {
  await connectToDatabase();

  const row = await RelationshipModel.findOne({ primaryUserId }).sort({ createdAt: -1 }).lean();

  if (!row) {
    return {
      status: 'none',
      overseerUsername: null,
      createdAt: null,
      inviteExpiresAt: null,
      revokedAt: null,
    };
  }

  const overseer = row.overseerUserId
    ? await UserModel.findById(row.overseerUserId, { username: 1 }).lean()
    : null;

  return {
    status: row.status as RelationshipView['status'],
    overseerUsername: overseer?.username ?? null,
    createdAt: row.createdAt.toISOString(),
    inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Constant-time token comparison, for anywhere a token is checked directly. */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
