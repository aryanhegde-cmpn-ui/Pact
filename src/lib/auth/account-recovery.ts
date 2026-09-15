import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { PactError } from '@/lib/api/errors';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  clearFailedAttempts,
  getLockoutState,
  lockoutKeyForUnknown,
  lockoutKeyForUser,
  recordFailedAttempt,
} from '@/lib/auth/throttle';
import { appendEvent } from '@/lib/db/events';
import { RecoveryCodeModel } from '@/lib/db/models/recovery-code';
import { RecoveryTokenModel } from '@/lib/db/models/recovery-token';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  isWellFormedRecoveryCode,
  normaliseRecoveryCode,
  RECOVERY_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  RECOVERY_TOKEN_PURPOSE,
  RECOVERY_TOKEN_TTL_MS,
} from '@/lib/schemas/account-recovery';
import { looksLikeEmail, normaliseUsername, passwordSchema } from '@/lib/schemas/user';

/**
 * Self-service account recovery, without an email provider.
 *
 * ---------------------------------------------------------------------------
 * ONE MESSAGE FOR EVERY FAILURE, AND ONE COUNTER SHARED WITH SIGN-IN.
 * ---------------------------------------------------------------------------
 * Unknown identifier, wrong code, already-consumed code, locked account and
 * expired token all return `GENERIC_RECOVERY_ERROR` and nothing else. The
 * reasons are the sign-in form's reasons: a public endpoint that distinguishes
 * "no such user" from "wrong code" is an enumeration oracle, and one that says
 * "your account is locked" confirms the account exists for free.
 *
 * The counter is the part most worth getting right. Recovery attempts record
 * against `lockoutKeyForUser(userId)` -- the SAME key the password form uses.
 * A separate counter would mean ten guesses at the password, then ten more at
 * a code, then ten more at the password once the first lock expired, and the
 * lockout would be decorative. `src/lib/auth/recovery-throttle.test.ts` asserts
 * both directions.
 * ---------------------------------------------------------------------------
 */
export const GENERIC_RECOVERY_ERROR = 'That identifier and code do not match.';

/** Thrown by the routes. Always the same message, always 400. */
export class RecoveryError extends PactError {
  constructor(message: string = GENERIC_RECOVERY_ERROR, status = 400) {
    super(message, status);
  }
}

export interface GeneratedCodes {
  /** PLAINTEXT, and the only time they exist outside a hash. */
  codes: string[];
  setId: string;
}

/** One code's worth of randomness, rejection-sampled so the alphabet stays uniform. */
function randomCode(): string {
  const alphabet = RECOVERY_ALPHABET;
  /**
   * `% alphabet.length` on a raw byte would bias the first 8 characters of a
   * 31-letter alphabet upwards, because 256 is not a multiple of 31. The
   * remainder is discarded instead, which costs a few extra bytes and keeps
   * every character equally likely.
   */
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';

  while (out.length < RECOVERY_CODE_LENGTH) {
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === RECOVERY_CODE_LENGTH) break;
    }
  }

  return out;
}

/** SHA-256, hex. For the token only -- codes get argon2. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a fresh set of ten codes and retires whatever came before.
 *
 * Returns the plaintext ONCE. Nothing stores it, nothing logs it, and no route
 * can read it back afterwards -- a "show me my codes again" endpoint would make
 * the account's recovery credential readable by whoever is already signed in on
 * a borrowed laptop, which is the situation this exists to survive.
 */
export async function generateRecoveryCodes(
  userId: string,
  now: Date = new Date(),
): Promise<GeneratedCodes> {
  await connectToDatabase();

  const user = await UserModel.findOne({ _id: userId }, { ownerId: 1 }).lean();
  if (!user) throw new RecoveryError('No such account.', 404);

  const setId = randomUUID();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomCode());

  await RecoveryCodeModel.insertMany(
    await Promise.all(
      codes.map(async (code) => ({
        userId,
        setId,
        codeHash: await hashPassword(code),
        createdAt: now,
        consumedAt: null,
      })),
    ),
  );

  /**
   * The pointer switch IS the invalidation, and it is one write.
   *
   * Until this lands the new codes are inert, because validity is defined as
   * matching the pointer. The instant it lands the previous set is inert for
   * the same reason. There is no ordering of two writes that gives that.
   */
  await UserModel.updateOne({ _id: userId }, { $set: { recoveryCodeSetId: setId } });

  await appendEvent({
    type: 'RECOVERY_CODES_GENERATED',
    entityType: 'account',
    entityId: userId,
    ownerId: user.ownerId ?? userId,
    ts: now,
    // Counts and identifiers only. A code in the event log is a code in every
    // timeline view that renders the log.
    payload: { count: codes.length, setId },
    source: 'user',
  });

  return { codes, setId };
}

/** How many of the live set are still unused. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  await connectToDatabase();

  const user = await UserModel.findOne({ _id: userId }, { recoveryCodeSetId: 1 }).lean();
  if (!user?.recoveryCodeSetId) return 0;

  return RecoveryCodeModel.countDocuments({
    userId,
    setId: user.recoveryCodeSetId,
    consumedAt: null,
  });
}

/**
 * A hash to verify against when the identifier matched nobody.
 *
 * Without it, an unknown identifier returns in the time one database read takes
 * while a known one spends argon2's deliberate ~100ms per candidate -- a
 * difference big enough to read over the network, which would turn "one message
 * for every failure" into a formality.
 *
 * It equalises the large signal, not every signal: a known account with ten
 * live codes still does up to ten verifications where this does one. Closing
 * that last gap means burning a second of CPU on every bogus request, which on
 * a Hobby function is a denial-of-service lever pointed at oneself. The
 * remaining difference is between one hash and ten, behind a counter that
 * allows ten attempts an hour.
 *
 * Computed once per process, lazily, so it costs nothing until somebody
 * guesses.
 */
let decoyHash: Promise<string> | null = null;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomCode());

  return decoyHash;
}

export interface VerifiedRecovery {
  /** The single-purpose token, plaintext, returned to the caller once. */
  token: string;
  expiresAt: Date;
}

/**
 * Step one: identifier and code together, and a token if they match.
 *
 * The code is NOT consumed here. It is consumed by the reset that uses it, so
 * an interrupted flow -- a closed tab, a second thought about the password --
 * costs nothing. What stops a code being spent twice is the conditional update
 * in `resetPasswordWithToken`, not this.
 */
export async function verifyRecoveryCode(
  identifierInput: string,
  codeInput: string,
  now: Date = new Date(),
): Promise<VerifiedRecovery> {
  await connectToDatabase();

  const identifier = identifierInput.trim();

  /**
   * Resolve first, then check the lockout -- the same order as sign-in, and
   * for the same reason: the counter keys on the ACCOUNT, so it cannot be
   * looked up until the account is known.
   */
  const user = looksLikeEmail(identifier)
    ? await UserModel.findOne(
        { email: identifier.toLowerCase() },
        { ownerId: 1, recoveryCodeSetId: 1 },
      ).lean()
    : await UserModel.findOne(
        { usernameLower: normaliseUsername(identifier) },
        { ownerId: 1, recoveryCodeSetId: 1 },
      ).lean();

  const key = user ? lockoutKeyForUser(String(user._id)) : lockoutKeyForUnknown(identifier);

  const lockout = await getLockoutState(key, now);
  if (lockout.locked) {
    // No record, no event: a locked account has already been counted, and
    // counting the attempts made while locked would extend the lock forever.
    throw new RecoveryError();
  }

  const code = normaliseRecoveryCode(codeInput);

  if (!user || !user.recoveryCodeSetId || !isWellFormedRecoveryCode(code)) {
    /**
     * Malformed input is verified against the decoy too.
     *
     * Returning early on a bad format would make "that is not even a code"
     * faster than "that is a code and it is wrong", which is a distinction the
     * caller is not supposed to be able to make.
     */
    await verifyPassword(await decoy(), code);
    await recordFailedAttempt(key, now);
    if (user)
      await recordFailure(String(user._id), user.ownerId ?? String(user._id), 'no-match', now);

    throw new RecoveryError();
  }

  const userId = String(user._id);

  /**
   * Every live code is tried in turn, and there is no index to shortcut it.
   *
   * A lookup column -- a fast hash of the code, or its first few characters --
   * would find the row in one read, and would also hand an attacker with a
   * database dump something to attack offline that is much weaker than argon2.
   * Ten sequential verifications is about a second in the worst case, on an
   * endpoint that allows ten attempts an hour. That is the right way round.
   */
  /**
   * `.select('+codeHash')` and NO projection argument.
   *
   * Passing `{ _id: 1 }` as well looks harmless and is not: the inclusive
   * projection wins, `codeHash` comes back undefined, and `verifyPassword`
   * quietly returns false for every candidate -- so a correct code is refused
   * with the same generic message as a wrong one, which is the hardest
   * possible version of this bug to see. It shipped past the unit tests
   * because the in-memory fake ignored projections; it now honours this one.
   */
  const candidates = await RecoveryCodeModel.find({
    userId,
    setId: user.recoveryCodeSetId,
    consumedAt: null,
  })
    .select('+codeHash')
    .lean();

  let matched: string | null = null;
  for (const candidate of candidates) {
    if (await verifyPassword(candidate.codeHash, code)) {
      matched = String(candidate._id);
      break;
    }
  }

  if (!matched) {
    await recordFailedAttempt(key, now);
    await recordFailure(userId, user.ownerId ?? userId, 'no-match', now);

    throw new RecoveryError();
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + RECOVERY_TOKEN_TTL_MS);

  await RecoveryTokenModel.create({
    userId,
    tokenHash: hashToken(token),
    codeId: matched,
    purpose: RECOVERY_TOKEN_PURPOSE,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  });

  return { token, expiresAt };
}

export interface ResetResult {
  userId: string;
  username: string;
  /** Stated on the confirmation screen, so a dwindling set is noticed. */
  remaining: number;
}

/**
 * Step two: set the password, consume everything, and end every other session.
 *
 * Each of the three claims is a conditional update rather than a read followed
 * by a write. Two tabs finishing the same flow, or a retried request, must
 * produce one reset -- and "check then write" is two steps with a race in the
 * middle.
 */
export async function resetPasswordWithToken(
  tokenInput: string,
  password: string,
  now: Date = new Date(),
): Promise<ResetResult> {
  await connectToDatabase();

  /**
   * The password is validated BEFORE the token is claimed.
   *
   * Otherwise a password one character too short burns the token and the code
   * with it, and the user is sent back to the start with nine codes left for a
   * typo. The rules are `passwordSchema` -- the same ones `change:password`
   * and the invite redemption apply, because a recovery path with weaker rules
   * is where the weak password goes.
   */
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    throw new RecoveryError(parsed.error.issues[0]?.message ?? 'Password rejected.', 422);
  }

  const claimed = await RecoveryTokenModel.findOneAndUpdate(
    {
      tokenHash: hashToken(tokenInput.trim()),
      purpose: RECOVERY_TOKEN_PURPOSE,
      consumedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { consumedAt: now } },
    { returnDocument: 'after' },
  ).lean();

  // Expired, already used, never existed, or the wrong purpose: one message.
  if (!claimed) throw new RecoveryError();

  const user = await UserModel.findOne(
    { _id: claimed.userId },
    { username: 1, ownerId: 1, recoveryCodeSetId: 1 },
  ).lean();
  if (!user) throw new RecoveryError();

  const userId = String(user._id);
  const ownerId = user.ownerId ?? userId;

  /**
   * The code is consumed here, conditionally.
   *
   * This is what makes a code single-use. Minting two tokens from one code is
   * possible and harmless -- both are worth exactly one password set between
   * them, because the second reset finds `consumedAt` already non-null and
   * stops before writing anything.
   */
  const consumed = await RecoveryCodeModel.updateOne(
    { _id: claimed.codeId, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) throw new RecoveryError();

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash: await hashPassword(parsed.data),
        /**
         * EVERY EXISTING SESSION DIES HERE.
         *
         * A reset that leaves whoever knew the old password signed in on their
         * own device has not recovered the account from anybody -- and an
         * Auth.js JWT is good for ninety days. `currentActor()` compares each
         * token's issue time against this.
         */
        sessionsValidFrom: now,
      },
    },
  );

  await appendEvent({
    type: 'RECOVERY_CODE_CONSUMED',
    entityType: 'account',
    entityId: userId,
    ownerId,
    ts: now,
    payload: { codeId: String(claimed.codeId) },
    source: 'user',
  });

  await appendEvent({
    type: 'PASSWORD_RESET_VIA_RECOVERY',
    entityType: 'account',
    entityId: userId,
    ownerId,
    ts: now,
    payload: { sessionsInvalidated: true },
    source: 'user',
  });

  // The lock is lifted by proving a code, exactly as it is by a correct
  // password: the account has been recovered, and leaving it locked would
  // punish the person who just proved they own it.
  await clearFailedAttempts(lockoutKeyForUser(userId));

  const remaining = await RecoveryCodeModel.countDocuments({
    userId,
    setId: user.recoveryCodeSetId,
    consumedAt: null,
  });

  return { userId, username: user.username, remaining };
}

/** One failed attempt against a known account, for the log rather than the counter. */
async function recordFailure(
  userId: string,
  ownerId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await appendEvent({
    type: 'RECOVERY_ATTEMPT_FAILED',
    entityType: 'account',
    entityId: userId,
    ownerId,
    ts: now,
    // The reason is a category, never the code that was tried.
    payload: { reason },
    source: 'system',
  });
}
