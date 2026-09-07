/**
 * The base class for every error the application raises deliberately.
 *
 * ---------------------------------------------------------------------------
 * WHY A BASE CLASS AND NOT A LIST OF NAMES
 * ---------------------------------------------------------------------------
 * The first attempt at fixing the invite 500 matched on
 * `error.constructor.name` against a list. It passed every unit test and still
 * returned 500 in the production build, because the minifier mangles class
 * names -- `RelationshipError` becomes `t`, matches nothing, and falls through
 * to the unhandled branch.
 *
 * That is the worst shape a fix can have: correct in every environment except
 * the one that matters, and silent about it. `instanceof` survives
 * minification, refactoring and re-export, so the check is structural rather
 * than textual.
 *
 * A scanner in `src/lib/api-errors.test.ts` fails on any error class under
 * `src/lib` that does not extend this, so adding one and forgetting the
 * translator cannot happen.
 * ---------------------------------------------------------------------------
 */
export class PactError extends Error {
  /** The HTTP status this failure deserves. Never 500: that is for surprises. */
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    /**
     * `new.target.name` rather than a literal, so a subclass reports its own
     * name in logs without restating it -- and so a mangled build still logs
     * SOMETHING, even if it is the mangled name. Nothing depends on this value.
     */
    this.name = new.target.name;
    this.status = status;
  }
}

/**
 * Whether a failure was raised deliberately, with a message meant to be read.
 *
 * The alternative -- a 500 with a stack trace -- tells the user nothing they
 * can act on and tells an attacker where the code lives.
 */
export function isPactError(error: unknown): error is PactError {
  return error instanceof PactError;
}
