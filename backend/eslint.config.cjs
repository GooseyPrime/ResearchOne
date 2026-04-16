// ESLint v9 flat config for the ResearchOne backend (CommonJS package).
// Uses @typescript-eslint/eslint-plugin v8 flat/recommended preset.
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // Base TypeScript config from @typescript-eslint flat/recommended
  // (sets languageOptions.parser, adds @typescript-eslint plugin and rules)
  ...tsPlugin.configs['flat/recommended'],

  // Project-level overrides applied to all TypeScript source files
  {
    files: ['src/**/*.ts'],
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
      // Downgrade no-explicit-any to a warning; error handling legitimately
      // uses unknown/any casts in this codebase.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks used for intentional swallowing
      '@typescript-eslint/no-empty-function': 'warn',
      // Allow require() calls in config/tooling contexts
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
