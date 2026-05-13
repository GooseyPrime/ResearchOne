/** Primary marketing header links — keep in sync with footer columns. */
export const MARKETING_HEADER_NAV = [
  { to: '/methodology', label: 'Methodology' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/security', label: 'Trust' },
  { to: '/compare', label: 'Compare' },
  { to: '/faq', label: 'FAQ' },
] as const;

export const MARKETING_FOOTER_LINKS = {
  product: [
    { to: '/pricing', label: 'Pricing' },
    { to: '/sample-report', label: 'Sample report' },
    { to: '/byok', label: 'BYOK' },
    { to: '/sovereign', label: 'Sovereign' },
  ],
  methodology: [
    { to: '/methodology', label: 'How it works' },
    { to: '/methodology#modes', label: 'Modes' },
    { to: '/docs', label: 'Docs' },
  ],
  trust: [
    { to: '/security', label: 'Security & data' },
    { to: '/faq', label: 'FAQ' },
  ],
  company: [
    { to: '/about', label: 'About' },
    { to: '/contact', label: 'Contact' },
    { to: '/changelog', label: 'Changelog' },
  ],
  legal: [
    { to: '/terms', label: 'Terms of service' },
    { to: '/privacy', label: 'Privacy policy' },
    { to: '/acceptable-use', label: 'Acceptable use' },
  ],
} as const;
