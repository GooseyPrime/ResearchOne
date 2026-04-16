// ESLint v9 flat config for the ResearchOne frontend (ESM package, "type":"module").
// Uses @typescript-eslint/eslint-plugin v8 flat/recommended and React-specific plugins.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // Base TypeScript config from @typescript-eslint flat/recommended
  ...tsPlugin.configs['flat/recommended'],

  // React-hooks rules (flat config format via recommended-latest)
  {
    ...reactHooks.configs['recommended-latest'],
    // Limit to source files only
    files: ['src/**/*.{ts,tsx}'],
  },

  // React-refresh rules
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Project-level overrides for all TypeScript/TSX source files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Allow intentionally unused parameters/variables when prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Downgrade no-explicit-any to a warning; error handling uses any casts
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
