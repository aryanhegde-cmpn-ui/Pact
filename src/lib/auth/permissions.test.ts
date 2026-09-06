import { describe, expect, it } from 'vitest';

import {
  ALL_CAPABILITIES,
  ALL_ROLES,
  can,
  canReadNotes,
  UNGRANTED_CAPABILITIES,
  type Capability,
} from './permissions';

/** Capabilities that write the work itself. */
const COMMITMENT_WRITES: Capability[] = [
  'commitment:write',
  'series:write',
  'reckoning:submit',
  'session:write',
];

/** Capabilities that configure stakes. */
const CONSEQUENCE_WRITES: Capability[] = ['consequence:write'];

describe('the primary', () => {
  it('can do the work', () => {
    for (const capability of COMMITMENT_WRITES) {
      expect(can('primary', capability)).toBe(true);
    }
  });

  it('is DENIED every consequence-configuration write', () => {
    /**
     * The load-bearing rule. An arrangement whose subject can edit their own
     * consequences is not an arrangement. This must hold at the permission
     * layer, not merely by there being no button.
     */
    for (const capability of CONSEQUENCE_WRITES) {
      expect(can('primary', capability)).toBe(false);
    }
  });

  it('can still READ its consequences', () => {
    // Not being able to change them is the point; not being able to see them
    // would make the arrangement arbitrary.
    expect(can('primary', 'consequence:read')).toBe(true);
  });

  it('can end the arrangement', () => {
    expect(can('primary', 'relationship:invite')).toBe(true);
    expect(can('primary', 'relationship:revoke')).toBe(true);
  });
});

describe('the overseer', () => {
  it('is DENIED every commitment write', () => {
    for (const capability of COMMITMENT_WRITES) {
      expect(can('overseer', capability)).toBe(false);
    }
  });

  it('can read progress', () => {
    expect(can('overseer', 'progress:read')).toBe(true);
  });

  it('can write consequences, and only that', () => {
    const writes = ALL_CAPABILITIES.filter(
      (capability) => capability.endsWith(':write') && can('overseer', capability),
    );

    expect(writes).toEqual(['consequence:write']);
  });

  it('cannot read focus session contents', () => {
    // The primary's working material, not evidence.
    expect(can('overseer', 'session:read')).toBe(false);
  });

  it('cannot revoke or invite', () => {
    expect(can('overseer', 'relationship:revoke')).toBe(false);
    expect(can('overseer', 'relationship:invite')).toBe(false);
  });

  it('cannot change settings', () => {
    // Including, critically, the note-sharing setting that governs what they
    // are allowed to read.
    expect(can('overseer', 'settings:write')).toBe(false);
  });
});

describe('the raw event log', () => {
  it('is granted to nobody', () => {
    for (const capability of UNGRANTED_CAPABILITIES) {
      for (const role of ALL_ROLES) {
        expect(can(role, capability)).toBe(false);
      }
    }
  });

  it('specifically excludes events:read for both roles', () => {
    // Exposed through purpose-built read models instead: a projection reveals
    // only what someone put in it, whereas a filtered log exposes every future
    // event type by default.
    expect(can('primary', 'events:read')).toBe(false);
    expect(can('overseer', 'events:read')).toBe(false);
  });
});

describe('free-text notes', () => {
  it('are always visible to the primary', () => {
    expect(canReadNotes('primary', false)).toBe(true);
    expect(canReadNotes('primary', true)).toBe(true);
  });

  it('are HIDDEN from the overseer by default', () => {
    /**
     * The categories carry the accountability value. The free text is where
     * the primary is honest with themselves, and they will be less honest if
     * they know it is read.
     */
    expect(canReadNotes('overseer', false)).toBe(false);
  });

  it('become visible only when the primary opts in', () => {
    expect(canReadNotes('overseer', true)).toBe(true);
  });
});

describe('the matrix itself', () => {
  it('grants no capability outside the declared list', () => {
    for (const role of ALL_ROLES) {
      const granted = ALL_CAPABILITIES.filter((capability) => can(role, capability));
      for (const capability of granted) {
        expect(ALL_CAPABILITIES).toContain(capability);
      }
    }
  });

  it('has no capability granted to nobody by accident', () => {
    // Every capability except the deliberately ungranted ones should be
    // reachable by someone, or it is dead weight that will confuse a reader.
    const orphans = ALL_CAPABILITIES.filter(
      (capability) =>
        !UNGRANTED_CAPABILITIES.includes(capability) &&
        !ALL_ROLES.some((role) => can(role, capability)),
    );

    expect(orphans).toEqual([]);
  });
});
