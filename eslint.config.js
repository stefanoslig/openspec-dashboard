// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

// Readability limits, set below the usual defaults on purpose: a function that trips one
// is a function to split, not a threshold to raise. Warnings, so the backlog does not fail CI;
// the Claude Code hook treats them as errors in every file it touches.
const readability = {
  complexity: ['warn', 8],
  'sonarjs/cognitive-complexity': ['warn', 8],
  'max-depth': ['warn', 2],
  'max-lines': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['warn', { max: 30, skipBlankLines: true, skipComments: true }],
  'max-params': ['warn', 3],
  'max-statements': ['warn', 12],
  'no-nested-ternary': 'warn',
};

export default defineConfig([
  globalIgnores(['dist/', '.angular/', 'test-results/', 'playwright-report/', 'demo/']),
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    plugins: { sonarjs },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      ...readability,
    },
  },
  {
    // Tests are tables of cases: long files and long describe blocks are the point.
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'max-statements': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/conditional-complexity': ['warn', { maxComplexity: 3 }],
    },
  },
]);
