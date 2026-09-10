const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    files: [
      'src/**/*.ts',
      'docs/.vitepress/**/*.mts',
      'docs/.vitepress/**/*.ts',
      'scripts/docs.test.mjs',
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2020 },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...js.configs.recommended.rules,
      // Preserve the existing lint policy; adopting these new rules requires runtime changes.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
    },
  },
];
