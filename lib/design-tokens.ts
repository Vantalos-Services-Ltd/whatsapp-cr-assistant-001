/**
 * Design tokens for operator UI
 * Linear/Stripe-inspired: calm, clean, confident
 */

export const typography = {
  fontFamily: {
    sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const;

export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '0.75rem',   // 12px
  base: '1rem',    // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const;

export const colors = {
  text: {
    primary: 'rgb(15, 23, 42)',      // slate-900
    secondary: 'rgb(100, 116, 139)', // slate-500
    muted: 'rgb(148, 163, 184)',     // slate-400
    disabled: 'rgb(203, 213, 225)',  // slate-300
  },
  border: {
    default: 'rgb(226, 232, 240)',  // slate-200
    muted: 'rgb(241, 245, 249)',     // slate-100
  },
  background: {
    default: 'rgb(255, 255, 255)',
    muted: 'rgb(248, 250, 252)',     // slate-50
    hover: 'rgb(241, 245, 249)',     // slate-100
  },
} as const;

