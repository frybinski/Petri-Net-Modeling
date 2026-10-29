import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    // The command line scripts report on the console.
    files: ['packages/llm/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // The scripts run in Node and report on the console; the screenshots also hand functions to
    // the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
  {
    // Threads and processes that the server tests start, and the launcher of the end-to-end tests, run in Node.
    files: ['apps/server/test/fixtures/**/*.mjs', 'apps/web/e2e/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/**/*.ts', '**/*.config.{js,ts}', 'apps/web/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
