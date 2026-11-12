// ESLint flat config. The older games are classic browser scripts; shared
// code and Driftworks are ES modules; the server is CommonJS; tests are
// Node ES modules.

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'helm/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['public/js/**/*.js', 'public/games/{snake,minesweeper,pipelines}/game.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    // Pipelines exports its generator for Node when `module` exists.
    files: ['public/games/pipelines/game.js'],
    languageOptions: { globals: { ...globals.browser, module: 'readonly' } },
  },
  {
    files: ['public/games/pipelines/worker.js'],
    languageOptions: { sourceType: 'script', globals: globals.worker },
  },
  {
    files: ['public/shared/**/*.js', 'public/games/driftworks/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['server.js', 'server/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
