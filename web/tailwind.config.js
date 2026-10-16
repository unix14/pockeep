/** Colors map to CSS variables defined in src/index.css, so light/dark is handled by tokens. */
const v = name => `var(--${name})`;
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), surface2: v('surface-2'), surface3: v('surface-3'), line: v('border'),
        fg: v('fg'), fg2: v('fg-2'), fg3: v('fg-3'),
        accent: v('accent'), 'accent-ink': v('accent-ink'), 'accent-soft': v('accent-soft'),
        good: v('good'), 'good-soft': v('good-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'), bad: v('bad'), 'bad-soft': v('bad-soft')
      },
      fontFamily: { ui: v('font-ui'), mono: v('font-mono') },
      boxShadow: { card: v('shadow'), lift: v('shadow-lift') }
    }
  },
  plugins: []
};
