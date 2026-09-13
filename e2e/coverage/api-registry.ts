import { covered, notApplicable, type ApiRegistration } from './cases';
import { anonymousTitle, forbiddenTitle, successTitle, validationTitle } from './cases';

/**
 * Every API route, and how each of its four cases is covered.
 *
 * ---------------------------------------------------------------------------
 * WHY FOUR CASES AND NOT ONE.
 * ---------------------------------------------------------------------------
 * They are four different code paths: the handler, the guard's session check,
 * the guard's capability check, and the schema. A route with a green success
 * test and nothing else is a route whose AUTHORISATION has never run under
 * test -- and authorisation is the part where a mistake is invisible until
 * somebody exploits it.
 *
 * `notApplicable` is a first-class answer, with a reason. A public route has no
 * 401 and a route with no body has no 422; saying so is a claim that can be
 * argued with, where an omitted field is indistinguishable from an oversight.
 * ---------------------------------------------------------------------------
 */

/** Every role holds these, so no signed-in caller can be refused for lacking one. */
const HELD_BY_EVERY_ROLE = 'every role holds this capability, so no signed-in caller is forbidden';

/** The overseer is the signed-in caller used to prove a 403 on the primary's routes. */
const overseerLacks = (capability: string): string =>
  `the overseer is signed in and has no ${capability}`;

const NO_BODY = 'takes no request body, so there is nothing to reject';
const PUBLIC = 'deliberately public: it reads no user data and takes no session';

function guarded(
  route: string,
  methods: ApiRegistration['methods'],
  capability: string,
  options: {
    shape?: readonly string[];
    success?: ApiRegistration['success'];
    forbidden?: ApiRegistration['forbidden'];
    validation?: ApiRegistration['validation'];
  } = {},
): ApiRegistration {
  return {
    route,
    methods,
    capability,
    shape: options.shape,
    success: options.success ?? covered(successTitle(route)),
    unauthenticated: covered(anonymousTitle(route)),
    forbidden: options.forbidden ?? covered(forbiddenTitle(route)),
    validation: options.validation ?? notApplicable(NO_BODY),
  };
}

export const API_REGISTRY: readonly ApiRegistration[] = [
  // --- The work ------------------------------------------------------------
  guarded('/api/today', ['GET'], 'commitment:read', {
    shape: ['dateLine', 'greeting', 'blocks', 'alsoToday', 'overdue'],
    forbidden: covered(forbiddenTitle('/api/today')),
  }),
  guarded('/api/commitments', ['GET', 'POST'], 'commitment:read', {
    shape: ['commitments', 'overdueTotal'],
    validation: covered(validationTitle('/api/commitments')),
  }),
  guarded('/api/commitments/[id]', ['GET', 'PATCH'], 'commitment:read', {
    shape: ['id', 'title', 'outcome', 'dueAt', 'originalDueAt', 'needsReckoning'],
    validation: covered(validationTitle('/api/commitments/[id]')),
  }),
  guarded('/api/commitments/[id]/complete', ['POST'], 'commitment:write', {
    success: covered('updates the page from the API rather than reloading it'),
  }),
  guarded('/api/commitments/[id]/abandon', ['POST'], 'commitment:write'),
  guarded('/api/commitments/[id]/start', ['POST'], 'commitment:write'),
  guarded('/api/commitments/[id]/deadline', ['POST'], 'commitment:write', {
    validation: covered(validationTitle('/api/commitments/[id]/deadline')),
  }),
  guarded('/api/commitments/[id]/reckoning', ['POST'], 'reckoning:submit', {
    success: covered('the reckoning flow answers a miss and applies a recovery action'),
    validation: covered(validationTitle('/api/commitments/[id]/reckoning')),
  }),
  guarded('/api/commitments/[id]/timeline', ['GET'], 'progress:read', {
    shape: ['commitmentId', 'entries', 'postponements'],
    forbidden: notApplicable(HELD_BY_EVERY_ROLE),
  }),
  guarded('/api/commitments/postponements', ['GET'], 'progress:read', {
    shape: ['relapsed', 'once', 'twice', 'chronic'],
    forbidden: notApplicable(HELD_BY_EVERY_ROLE),
  }),
  guarded('/api/series', ['GET', 'POST'], 'series:read', {
    shape: ['series'],
    validation: covered(validationTitle('/api/series')),
  }),
  guarded('/api/series/[id]', ['PATCH', 'DELETE'], 'series:write', {
    success: covered('ending a series leaves its past occurrences alone'),
    validation: covered(validationTitle('/api/series/[id]')),
  }),

  // --- The study plan ------------------------------------------------------
  guarded('/api/curriculum', ['GET'], 'curriculum:read', { shape: ['blocks', 'resources'] }),
  guarded('/api/curriculum/phases', ['GET'], 'curriculum:read', { shape: ['phases'] }),
  guarded('/api/curriculum/today', ['GET', 'POST'], 'curriculum:read', {
    shape: ['blocks', 'rhythm', 'evening'],
    validation: covered(validationTitle('/api/curriculum/today')),
  }),
  guarded('/api/curriculum/review', ['GET', 'POST'], 'curriculum:read', {
    shape: ['flagged'],
    validation: covered(validationTitle('/api/curriculum/review')),
  }),
  guarded('/api/curriculum/progress', ['POST'], 'curriculum:write', {
    success: covered('recording topic progress moves it out of not-started'),
    validation: covered(validationTitle('/api/curriculum/progress')),
  }),
  guarded('/api/curriculum/replan', ['POST'], 'curriculum:write', {
    success: covered('re-planning a phase requires a reason and shifts the ones after it'),
    validation: covered(validationTitle('/api/curriculum/replan')),
  }),

  // --- Focus sessions ------------------------------------------------------
  guarded('/api/focus', ['GET'], 'session:read', { shape: ['session'] }),
  guarded('/api/focus/start', ['POST'], 'session:write', {
    success: covered('a focus session runs on the server clock and locks writes'),
  }),
  guarded('/api/focus/end', ['POST'], 'session:write', {
    success: covered('a focus session runs on the server clock and locks writes'),
  }),
  guarded('/api/focus/interrupt', ['POST'], 'session:write', {
    success: covered('an interruption is recorded against the running session'),
  }),
  guarded('/api/focus/budget', ['POST'], 'session:write', {
    success: covered('the research budget interrupts once and takes a justification'),
  }),

  // --- Notifications -------------------------------------------------------
  guarded('/api/notifications', ['GET', 'POST'], 'progress:read', {
    shape: ['items', 'unread'],
    forbidden: notApplicable(HELD_BY_EVERY_ROLE),
  }),

  // --- Stakes: the overseer's, and refused to the primary ------------------
  {
    route: '/api/stakes/rewards',
    methods: ['POST'],
    capability: 'consequence:write',
    success: covered('adds a reward and grants it by hand'),
    unauthenticated: covered(anonymousTitle('/api/stakes/rewards')),
    forbidden: covered('the primary cannot configure anything'),
    validation: covered(validationTitle('/api/stakes/rewards')),
  },
  {
    route: '/api/stakes/rewards/[id]',
    methods: ['PATCH'],
    capability: 'consequence:write',
    success: covered('adds a reward and grants it by hand'),
    unauthenticated: covered(anonymousTitle('/api/stakes/rewards/[id]')),
    forbidden: covered('the primary cannot configure anything'),
    /**
     * Not the generic sweep: it substitutes a COMMITMENT id into every `[id]`,
     * so a stakes route 404s before its schema runs. Asserted in the
     * walkthrough, where a real reward exists to address.
     */
    validation: covered('the primary claims a reward the overseer granted'),
  },
  {
    route: '/api/stakes/consequences',
    methods: ['POST'],
    capability: 'consequence:write',
    success: covered('adds a consequence, and the window is capped'),
    unauthenticated: covered(anonymousTitle('/api/stakes/consequences')),
    forbidden: covered('the primary cannot configure anything'),
    validation: covered('adds a consequence, and the window is capped'),
  },
  {
    route: '/api/stakes/consequences/[id]',
    methods: ['PATCH'],
    capability: 'consequence:write',
    success: covered('a consequence is configured, and its status cannot be set by hand'),
    unauthenticated: covered(anonymousTitle('/api/stakes/consequences/[id]')),
    forbidden: covered('the primary cannot configure anything'),
    validation: covered('a consequence is configured, and its status cannot be set by hand'),
  },
  {
    route: '/api/stakes/grant',
    methods: ['POST'],
    capability: 'consequence:write',
    success: covered('adds a reward and grants it by hand'),
    unauthenticated: covered(anonymousTitle('/api/stakes/grant')),
    forbidden: covered('the primary cannot grant themselves a reward'),
    validation: covered(validationTitle('/api/stakes/grant')),
  },
  guarded('/api/rewards/claim', ['POST'], 'reward:claim', {
    success: covered('the primary claims a reward the overseer granted'),
    forbidden: covered(forbiddenTitle('/api/rewards/claim')),
    validation: covered(validationTitle('/api/rewards/claim')),
  }),
  guarded('/api/vacation', ['GET', 'POST'], 'commitment:read', {
    shape: ['on', 'since'],
    success: covered('vacation mode goes on and off from settings'),
    validation: covered(validationTitle('/api/vacation')),
  }),
  guarded('/api/overseer', ['GET'], 'progress:read', {
    shape: ['adherence'],
    success: covered('shows adherence as a rate over a window'),
    forbidden: notApplicable(HELD_BY_EVERY_ROLE),
  }),

  // --- Recovery mode (the backlog), distinct from account recovery ---------
  guarded('/api/recovery', ['GET', 'POST'], 'commitment:read', {
    shape: ['active'],
    success: covered('offers three slots and nothing to scroll'),
    validation: covered(validationTitle('/api/recovery')),
  }),

  // --- The arrangement -----------------------------------------------------
  guarded('/api/relationship/invite', ['GET', 'POST'], 'relationship:invite', {
    shape: ['status'],
    success: covered('the overseer joins by invite and lands on the record'),
  }),
  guarded('/api/relationship/revoke', ['POST'], 'relationship:revoke', {
    success: covered('revoking ends the arrangement and leaves what was earned'),
  }),
  guarded('/api/settings', ['GET', 'PATCH'], 'settings:read', {
    shape: ['quietHoursStart', 'quietHoursEnd'],
    validation: covered(validationTitle('/api/settings')),
  }),
  guarded('/api/recovery/codes', ['POST'], 'recovery:manage', {
    success: covered('regenerating from settings invalidates the previous set'),
    forbidden: notApplicable(HELD_BY_EVERY_ROLE),
  }),

  // --- Session-guarded directly, with no capability ------------------------
  {
    route: '/api/push/subscribe',
    methods: ['GET', 'POST', 'DELETE'],
    capability: null,
    shape: ['subscriptions'],
    success: covered(successTitle('/api/push/subscribe')),
    unauthenticated: covered(anonymousTitle('/api/push/subscribe')),
    forbidden: notApplicable('no capability: it is scoped to the caller own devices'),
    validation: covered(validationTitle('/api/push/subscribe')),
  },
  {
    route: '/api/push/test',
    methods: ['POST'],
    capability: null,
    shape: ['ok'],
    success: covered(successTitle('/api/push/test')),
    unauthenticated: covered(anonymousTitle('/api/push/test')),
    forbidden: notApplicable('no capability: it sends only to the caller own devices'),
    validation: notApplicable(NO_BODY),
  },
  {
    route: '/api/health/detail',
    methods: ['GET'],
    capability: null,
    shape: ['configuration'],
    success: covered(successTitle('/api/health/detail')),
    unauthenticated: covered(anonymousTitle('/api/health/detail')),
    forbidden: notApplicable('no capability: it reports only on the caller own scope'),
    validation: notApplicable(NO_BODY),
  },

  // --- Public, and public on purpose ---------------------------------------
  {
    route: '/api/health',
    methods: ['GET'],
    capability: null,
    shape: ['status'],
    success: covered(successTitle('/api/health')),
    unauthenticated: notApplicable(PUBLIC),
    forbidden: notApplicable(PUBLIC),
    validation: notApplicable(NO_BODY),
  },
  {
    route: '/api/auth/[...nextauth]',
    methods: ['GET', 'POST'],
    capability: null,
    success: covered('providers returns 200 with the credentials provider'),
    unauthenticated: notApplicable('this IS the sign-in route; there is no session yet'),
    forbidden: notApplicable('no capability model applies before a session exists'),
    validation: covered('says the same thing for a wrong password and an unknown user'),
  },
  {
    route: '/api/notifications/dispatch',
    methods: ['GET', 'POST'],
    capability: null,
    shape: ['ok'],
    success: covered('the dispatch endpoint delivers what is due'),
    unauthenticated: covered('the dispatch endpoint refuses a wrong bearer token'),
    forbidden: notApplicable('a machine endpoint with one credential and no roles'),
    validation: notApplicable(NO_BODY),
  },
  {
    route: '/api/relationship/redeem',
    methods: ['POST'],
    capability: null,
    success: covered('the overseer joins by invite and lands on the record'),
    unauthenticated: notApplicable('unauthenticated by necessity: the redeemer has no account yet'),
    forbidden: notApplicable('no session exists, so no capability can be checked'),
    validation: covered(validationTitle('/api/relationship/redeem')),
  },
  {
    route: '/api/recovery/verify',
    methods: ['POST'],
    capability: null,
    success: covered('a code sets a new password, signs in, and cannot be used twice'),
    unauthenticated: notApplicable('unauthenticated by necessity: the caller cannot sign in'),
    forbidden: notApplicable('no session exists, so no capability can be checked'),
    validation: covered('says the same thing for an unknown account and a wrong code'),
  },
  {
    route: '/api/recovery/reset',
    methods: ['POST'],
    capability: null,
    success: covered('a code sets a new password, signs in, and cannot be used twice'),
    unauthenticated: notApplicable('unauthenticated by necessity: the caller cannot sign in'),
    forbidden: notApplicable('no session exists, so no capability can be checked'),
    validation: covered('the token it issues does nothing but set a password'),
  },
] as const;

/** Capabilities the overseer also holds, so a 403 sweep must skip them. */
export const OVERSEER_CAPABILITIES = [
  'progress:read',
  'consequence:read',
  'consequence:write',
  'recovery:manage',
] as const;

export { overseerLacks };
