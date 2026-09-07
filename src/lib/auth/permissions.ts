/**
 * The permission matrix.
 *
 * ONE module. Every route guard derives from this table rather than testing
 * `role === 'overseer'` inline. Scattered role checks are how a new route ends
 * up with a subtly different rule, and how the fifteenth handler is the one
 * that forgot — which is the same failure mode the dueAt scanner exists to
 * prevent.
 *
 * Not `server-only`: the client needs it to decide what to render, and it
 * contains no secrets. Rendering is a convenience; the server enforces.
 */

export type Role = 'primary' | 'overseer';

/**
 * Capabilities, named for what they let you do rather than which route they
 * sit behind. A route can move without the matrix changing.
 */
export type Capability =
  // --- The work itself -----------------------------------------------------
  | 'commitment:read'
  | 'commitment:write'
  | 'series:read'
  | 'series:write'
  | 'reckoning:submit'
  | 'session:read'
  | 'session:write'
  // --- The study plan ------------------------------------------------------
  /** The curriculum, the phases, today's blocks and the review list. */
  | 'curriculum:read'
  /** Topic progress, target corrections, topic overrides and re-planning. */
  | 'curriculum:write'
  // --- The record ----------------------------------------------------------
  /** Completion state, misses, deadline changes, reckoning CATEGORIES. */
  | 'progress:read'
  /** Free-text notes on commitments and reckonings. Gated by a setting. */
  | 'notes:read'
  /** The raw append-only log. Nobody gets this over HTTP. */
  | 'events:read'
  // --- Stakes --------------------------------------------------------------
  /** Rewards and consequences: what is configured, and what is active. */
  | 'consequence:read'
  /**
   * Configuring them. THE PRIMARY MUST NEVER HOLD THIS.
   *
   * Covers rewards as well as consequences: they are one subsystem, and a
   * separate `reward:write` the primary happened to hold would let them grant
   * themselves the thing the arrangement is about.
   */
  | 'consequence:write'
  /** Claiming a reward already earned. The primary's own action. */
  | 'reward:claim'
  /**
   * Vacation mode. The PRIMARY's, and deliberately not the overseer's.
   *
   * A vacation an overseer can veto is one you route around by not opening the
   * app -- and an accountability tool nobody opens reports nothing at all.
   */
  | 'vacation:write'
  // --- The arrangement -----------------------------------------------------
  | 'relationship:invite'
  | 'relationship:revoke'
  | 'settings:read'
  | 'settings:write';

/**
 * The matrix.
 *
 * Read it as: this role may do exactly these things, and nothing else.
 */
const MATRIX: Record<Role, readonly Capability[]> = {
  /**
   * The person doing the work.
   *
   * Note what is ABSENT: `consequence:write`. The primary has no write path to
   * reward or consequence configuration -- not a hidden route, not a field
   * quietly ignored. A route must REJECT it. An arrangement whose subject can
   * edit their own consequences is not an arrangement, and building the
   * permission surface now means the later consequence PR slots into it rather
   * than inventing its own rules.
   */
  primary: [
    'commitment:read',
    'commitment:write',
    'series:read',
    'series:write',
    'reckoning:submit',
    'session:read',
    'session:write',
    'curriculum:read',
    'curriculum:write',
    'progress:read',
    'notes:read',
    'consequence:read',
    'reward:claim',
    'vacation:write',
    'relationship:invite',
    'relationship:revoke',
    'settings:read',
    'settings:write',
  ],

  /**
   * The person holding the stakes.
   *
   * Read access to the record, write access to consequences, and nothing else.
   *
   * `notes:read` is absent and granted conditionally -- see
   * `canReadNotes`. `session:read` is absent because focus session contents
   * are the primary's working material, not evidence. `curriculum:read` is
   * absent deliberately rather than by oversight: what the overseer needs is
   * whether commitments are being kept, which `progress:read` already gives
   * them. Granting the plan itself is a decision for whoever builds the
   * overseer's view of it, not a side effect of the curriculum landing. `events:read` is absent
   * for everyone: the raw log is exposed through purpose-built read models
   * instead, which is both safer and simpler than filtering events per role at
   * every call site.
   */
  overseer: ['progress:read', 'consequence:read', 'consequence:write'],
};

/**
 * Whether a role holds a capability outright.
 *
 * ---------------------------------------------------------------------------
 * AN UNRECOGNISED ROLE HOLDS NOTHING. IT DOES NOT THROW.
 * ---------------------------------------------------------------------------
 * This used to be `MATRIX[role].includes(...)`, which throws a TypeError when
 * `role` is not a key -- and it is called from the guard OUTSIDE the handler's
 * try/catch, so the throw escaped as a bare 500 where 403 is the correct
 * answer.
 *
 * That was reachable in production. Sessions are 90-day JWTs carrying the role
 * copied at sign-in, and `seedUser` once wrote `role: 'owner'`, which is in no
 * enum. Any session minted before that fix produced a 500 on every guarded
 * route while pages kept rendering, because pages use `currentActor()` and
 * never call this.
 *
 * Failing closed is the only safe reading: an unknown role is not a role, and
 * a role that is not in the matrix has no entry saying what it may do.
 * ---------------------------------------------------------------------------
 */
export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

/** Whether a value is a role the matrix knows about. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in MATRIX;
}

/**
 * Whether an overseer may read free text.
 *
 * The default is NO, and it is a deliberate product decision rather than a
 * conservative default. Structured categories are always visible, and that is
 * where the accountability value is: "missed, avoidance, three times" is the
 * fact worth acting on.
 *
 * The free text is where the primary is honest with themselves -- and they
 * will be less honest if they know it is read. Making it opt-in keeps the
 * useful signal and protects the thing that produces it.
 */
export function canReadNotes(role: Role, primaryAllowsNoteSharing: boolean): boolean {
  if (role === 'primary') return true;

  return primaryAllowsNoteSharing;
}

/** Every capability, for exhaustive tests over the matrix. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  'commitment:read',
  'commitment:write',
  'series:read',
  'series:write',
  'reckoning:submit',
  'session:read',
  'session:write',
  'curriculum:read',
  'curriculum:write',
  'progress:read',
  'notes:read',
  'events:read',
  'consequence:read',
  'consequence:write',
  'reward:claim',
  'vacation:write',
  'relationship:invite',
  'relationship:revoke',
  'settings:read',
  'settings:write',
];

export const ALL_ROLES: readonly Role[] = ['primary', 'overseer'];

/**
 * Capabilities nobody has over HTTP.
 *
 * Kept as an explicit list so "no route exposes this" is a testable claim
 * rather than an absence someone has to notice.
 */
export const UNGRANTED_CAPABILITIES: readonly Capability[] = ['events:read'];

/**
 * Configuring stakes. The primary holds none of these, ever.
 *
 * Exported as a list so the rule can be checked by ENUMERATION rather than by
 * naming routes: `src/lib/stakes-authorization.test.ts` walks every route file
 * under `api/stakes/` and fails if any of them requires a capability the
 * primary holds. A route added later without a guard, or with the wrong one,
 * fails without anybody remembering to add it to a list.
 *
 * An arrangement whose subject can edit their own consequences is not an
 * arrangement.
 */
export const STAKES_CONFIG_CAPABILITIES: readonly Capability[] = ['consequence:write'];
