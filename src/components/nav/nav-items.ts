export interface NavItem {
  href: string;
  label: string;
  /** Path data for a 24x24 stroked icon. */
  icon: string;
}

export const navItems: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  },
  {
    href: '/study',
    label: 'Study',
    icon: 'M12 6.5 4 4v13l8 2.5L20 17V4l-8 2.5Zm0 0V19',
  },
  {
    href: '/postponements',
    label: 'Postponements',
    icon: 'M12 8v5l3 2M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z',
  },
  {
    href: '/overseer',
    label: 'The record',
    icon: 'M12 5c-5 0-9 4.5-9 7s4 7 9 7 9-4.5 9-7-4-7-9-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z',
  },
] as const;
