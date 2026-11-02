export function applyTheme(preference: 'light' | 'dark' | 'system') {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
}
