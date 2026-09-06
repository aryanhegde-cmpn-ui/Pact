import mongoose from 'mongoose';

/**
 * Makes Mongoose validate updates, which it does not do on its own.
 *
 * ---------------------------------------------------------------------------
 * THE HOLE THIS CLOSES
 * ---------------------------------------------------------------------------
 * `save()` validates. `updateOne`, `updateMany`, `findOneAndUpdate`,
 * `replaceOne` and `findOneAndReplace` do NOT, unless every call site
 * remembers `runValidators: true`. That is the shape of rule this codebase has
 * twice decided not to trust to memory -- see the `dueAt` writer scanner and
 * the ownership scanner, both of which have caught real bugs.
 *
 * It had already caught one here. `seedUser` wrote `role: 'owner'` through
 * `updateOne`. The field is `enum: ['primary', 'overseer']`, the value is in
 * neither, and Mongo accepted it silently -- producing an account that failed
 * every capability check and could not sign in by username. Nothing raised an
 * error, because nothing validated.
 *
 * Set globally rather than per call, because the failure mode IS a call site
 * that forgets, so the fix cannot be a thing call sites have to remember.
 *
 * A global rather than a schema plugin, specifically: `mongoose.plugin()` only
 * reaches schemas compiled after it runs, and a model's middleware is fixed
 * when `mongoose.model()` compiles it. The model modules are evaluated at
 * import time, long before a Next route connects, so a plugin registered on
 * connect would silently cover nothing at all. A global option is resolved
 * when the query runs.
 *
 * `setDefaultsOnInsert` comes with it: an upsert that creates a document
 * without its schema defaults produces a row no `save()` could have produced.
 * ---------------------------------------------------------------------------
 *
 * What this does NOT cover, and why the scanner in
 * `src/lib/db-validation.test.ts` exists alongside it:
 *
 *   - `bulkWrite`, which does not run update validators at all.
 *   - Raw driver access through `mongoose.connection.db.collection(...)`,
 *     which bypasses Mongoose and its schemas entirely.
 *   - A call passing `runValidators: false`, which overrides this.
 */
let registered = false;

export function registerUpdateValidation(): void {
  if (registered) return;
  registered = true;

  mongoose.set('runValidators', true);
  mongoose.set('setDefaultsOnInsert', true);
}

/** Whether the global has been applied. Read by a test, not by app code. */
export function updateValidationIsOn(): boolean {
  return mongoose.get('runValidators') === true;
}
