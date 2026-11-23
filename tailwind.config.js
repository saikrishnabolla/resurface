export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {
    colors: { cream: '#080A09', surface: '#141917', ink: '#F7F8F5', emerald: '#7BDDB0', deep: '#064735',
      mute: '#9CA7A1', line: '#2A322E', forest: '#080A09', gold: '#D9B65D' },
    fontFamily: { sans: ['Manrope', 'system-ui', 'Segoe UI', 'sans-serif'], serif: ['Manrope', 'system-ui', 'sans-serif'] },
  } },
};
