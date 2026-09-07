import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every script that touches the database says which one, before it acts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCANNER AND NOT A CONVENTION
 * ---------------------------------------------------------------------------
 * `change:password` prompted for a password, hashed it, wrote it, and printed
 * "Password changed for aryan.hegde@wizergos.com." It never said which
 * database. Every one of these scripts reads MONGODB_URI from the shell first
 * and `.env.local` second, so an override exported earlier in the same
 * terminal silently redirects the next command -- and the same email address
 * exists in more than one database, so the write succeeds and reports success
 * in the wrong place.
 *
 * That cost a locked-out production account and an afternoon. A convention
 * would not have caught it, because the script that broke the rule was written
 * before the rule existed.
 * ---------------------------------------------------------------------------
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPTS = join(ROOT, 'scripts');

const FILES = readdirSync(SCRIPTS)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, code: readFileSync(join(SCRIPTS, name), 'utf8') }));

/** A script that opens a connection is a script that has a target to name. */
const DATABASE_SCRIPTS = FILES.filter(({ code }) => code.includes('connectToDatabase'));

describe('scripts name their target', () => {
  it('finds the database scripts at all', () => {
    // Guards the scan itself: a rename that emptied this list would make every
    // assertion below vacuously true.
    expect(DATABASE_SCRIPTS.length).toBeGreaterThan(8);
  });

  it('announces the target in every script that connects', () => {
    const silent = DATABASE_SCRIPTS.filter(({ code }) => !code.includes('announceTarget(')).map(
      ({ name }) => name,
    );

    expect(silent).toEqual([]);
  });

  it('announces before connecting, not after', () => {
    /**
     * A connection that fails is exactly when the target matters most: "cannot
     * connect" with no host named sends the operator to the wrong dashboard.
     */
    const late = DATABASE_SCRIPTS.filter(({ code }) => {
      const announce = code.indexOf('announceTarget(', code.indexOf("from './target'") + 1);
      const connect = code.indexOf('await connectToDatabase(');

      return announce === -1 || (connect !== -1 && announce > connect);
    }).map(({ name }) => name);

    expect(late).toEqual([]);
  });

  it('never prints a connection string, only host and database', () => {
    /**
     * `describeUri` strips credentials. Interpolating MONGODB_URI directly puts
     * the cluster password on screen and then into whatever the operator pasted
     * the output into.
     */
    const leaking = FILES.filter(({ code }) =>
      /console\.log\([^)]*\$\{[^}]*MONGODB_URI[^}]*\}/.test(
        code.replace(/describeUri\([^)]*\)/g, ''),
      ),
    ).map(({ name }) => name);

    expect(leaking).toEqual([]);
  });
});

describe('the recovery path refuses to run by accident', () => {
  it('requires --confirm', () => {
    const source = readFileSync(join(SCRIPTS, 'access-reset.ts'), 'utf8');

    expect(source).toContain('requireConfirm(');
  });

  it('never writes the generated password to a file', () => {
    const source = readFileSync(join(SCRIPTS, 'access-reset.ts'), 'utf8');

    // Printed once, to stdout, and nowhere else. A password in a file is a
    // password in a backup, a sync client and a shell history.
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/);
  });

  it('lists the accounts before asking which one to reset', () => {
    const source = readFileSync(join(SCRIPTS, 'access-reset.ts'), 'utf8');
    const listing = source.indexOf('Accounts here:');
    const confirm = source.indexOf('requireConfirm(');

    expect(listing).toBeGreaterThan(-1);
    expect(listing).toBeLessThan(confirm);
  });
});

describe('users:list is read-only', () => {
  it('never writes', () => {
    const source = readFileSync(join(SCRIPTS, 'users-list.ts'), 'utf8');

    expect(source).not.toMatch(/updateOne|updateMany|deleteOne|deleteMany|insertMany|\.create\(/);
  });

  it('never selects the password hash', () => {
    // Comments stripped: the file explains at length that it does not read the
    // hash, and the word appearing in that explanation is not a projection.
    const source = readFileSync(join(SCRIPTS, 'users-list.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(source).not.toContain('passwordHash');
  });
});
