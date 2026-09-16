// Single source for colors — import this, never hardcode hex. Mirrors Cloud_IDE_frontend palette.
export const theme = {
  brand: {
    cyan500: '#06B6D4',
    cyan600: '#0891B2',
    cyan700: '#0E7490',
  },
  dark: {
    bg: '#111827', // gray-900
    bgSoft: '#1F2937', // gray-800
    bgCard: '#1E1E1E',
    card: '#252526',
    border: '#3C3C3C',
    text: '#D4D4D4',
    muted: '#9CA3AF',
  },
  light: {
    bg: '#FFFFFF',
    bgSoft: '#F9FAFB',
    border: '#E5E7EB',
  },
  status: {
    success: '#10B981',
    error: '#EF4444',
    warn: '#F59E0B',
  },
  accent: {
    blue: '#3B82F6',
  },
} as const;

// Tailwind class shortcuts — keeps components consistent with old Hero/Login/Features
export const classes = {
  heroBg: 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900',
  card: 'bg-white dark:bg-gray-900 p-6 rounded-lg shadow-lg',
  cardDark: 'bg-gray-800 p-10 rounded-xl shadow-lg',
  inputDark: 'bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500',
  btnPrimary: 'bg-cyan-500 hover:bg-cyan-600 text-white',
  btnDark: 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600',
} as const;
