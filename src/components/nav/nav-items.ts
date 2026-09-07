export interface NavItem {
  href: string;
  label: string;
  /** Path data for a 24x24 stroked icon. */
  icon: string;
  /** Recovery mode takes this surface away. See `recovery-gate.ts`. */
  gatedInRecovery?: boolean;
}

/**
 * The primary bar.
 *
 * Five, because that is what fits at 390px without the labels truncating, and
 * because a sixth would be there to hold something that is not a daily
 * destination.
 *
 * Blocks 1, 2 and 3 are sections WITHIN Study rather than tabs of their own.
 * The earlier DSA / Learning / Frontend split predates the block model and
 * describes a different product: those were three subjects, whereas these are
 * three windows in one morning against one curriculum. Three tabs would
 * suggest three plans.
 */
export const navItems: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Today',
    icon: 'M12 7v5l3 2M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z',
  },
  {
    href: '/tomorrow',
    label: 'Tomorrow',
    icon: 'M5 5h14v14H5zM5 9h14M9 13l2 2 4-4',
  },
  {
    href: '/week',
    label: 'Week',
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    href: '/study',
    label: 'Study',
    icon: 'M12 6.5 4 4v13l8 2.5L20 17V4l-8 2.5Zm0 0V19',
    gatedInRecovery: true,
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: 'M4 19V9m5 10V5m5 14v-7m5 7V8',
  },
] as const;

/**
 * Reachable, but not a daily destination.
 *
 * Postponements is evidence you go looking for, not a tab you tap on the way
 * to work. Settings is neither, and it stays reachable even in recovery mode
 * -- locking someone out of settings during a restrictive state is how they
 * get stuck in it.
 */
export const secondaryNavItems: readonly NavItem[] = [
  {
    href: '/postponements',
    label: 'Postponements',
    icon: 'M12 8v5l3 2M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z',
    gatedInRecovery: true,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z',
  },
] as const;

/** What the nav should show, given whether recovery is active. */
export function visibleNavItems(
  items: readonly NavItem[],
  inRecovery: boolean,
): readonly NavItem[] {
  return inRecovery ? items.filter((item) => !item.gatedInRecovery) : items;
}
