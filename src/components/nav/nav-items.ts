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
    href: '/mirror',
    label: 'Mirror',
    icon: 'M5 3h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 18h6',
  },
] as const;
