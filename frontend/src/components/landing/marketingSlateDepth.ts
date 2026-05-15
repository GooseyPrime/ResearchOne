import type { CSSProperties } from 'react';

/**
 * Shared landing depth wash — inline `backgroundImage` so stacked
 * gradients resolve reliably (Tailwind arbitrary `bg-[radial-gradient…]`
 * can mis-parse when commas appear inside arbitrary segments).
 */
export const MARKETING_SLATE_DEPTH_LAYERS: CSSProperties = {
  backgroundImage: [
    'radial-gradient(ellipse 130% 100% at 50% -18%, rgba(148, 163, 184, 0.45) 0%, rgba(71, 85, 105, 0.24) 40%, transparent 68%)',
    'radial-gradient(ellipse 115% 75% at 50% 108%, rgba(2, 6, 23, 0.96) 0%, rgba(15, 23, 42, 0.4) 48%, transparent 74%)',
    'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, transparent 11%, transparent 80%, rgba(2, 6, 23, 0.55) 100%)',
  ].join(','),
};
