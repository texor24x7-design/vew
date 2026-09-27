import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  // The landing page's plain script runs in the browser.
  {
    files: ['website/**/*.js'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'window',
          'document',
          'navigator',
          'setTimeout',
          'clearTimeout',
          'addEventListener',
          'IntersectionObserver'
        ].map((name) => [name, 'readonly'])
      )
    }
  }
)
