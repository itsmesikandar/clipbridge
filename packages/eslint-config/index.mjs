// Shared ESLint flat configs for ClipBridge.
//
// Every package composes these in its own `eslint.config.mjs`:
//   base()             TypeScript rules for any package
//   react()            React + hooks rules (desktop renderer, mobile)
//   platformNeutral()  forbids platform imports (packages shared by all apps)
//   coreBoundaries()   enforces clean-architecture rules inside packages/core

import { builtinModules } from 'node:module';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

/**
 * TypeScript rules shared by every package.
 * @param {{ tsconfigRootDir: string }} options directory of the package's tsconfig.json
 */
export function base({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores([
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/ios/**',
      '**/android/**',
    ]),
    js.configs.recommended,
    {
      files: TS_FILES,
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      plugins: { 'simple-import-sort': simpleImportSort },
      rules: {
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/consistent-type-exports': 'error',
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/switch-exhaustiveness-check': [
          'error',
          { considerDefaultExhaustiveForUnions: true },
        ],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: globals.node },
    },
    {
      files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,mts}'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    },
  );
}

/** React + hooks rules. Use together with `base()`. */
export function react() {
  return defineConfig({
    files: ['**/*.tsx', '**/use-*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  });
}

const PLATFORM_MODULES = [
  ...builtinModules,
  'react',
  'react-dom',
  'react-native',
  'electron',
  'expo',
  'ws',
  'bonjour-service',
];

const PLATFORM_IMPORT_PATTERNS = [
  {
    regex:
      '^(node:|react/|react-dom/|react-native/|react-native-|electron/|electron-|expo-|@expo/)',
    message: 'packages/core must stay platform-neutral. Define a port and implement it in an app.',
  },
];

const platformRestriction = {
  paths: PLATFORM_MODULES.map((name) => ({
    name,
    message: 'packages/core must stay platform-neutral. Define a port and implement it in an app.',
  })),
  patterns: PLATFORM_IMPORT_PATTERNS,
};

/** Shared packages that both apps use: no Node, Electron, React Native or Expo imports. */
export function platformNeutral() {
  return defineConfig({
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', platformRestriction] },
  });
}

/**
 * Clean-architecture boundaries for packages/core (see docs/PLAN.md §5.1):
 * - nothing in core may import platform modules;
 * - domain/ may not import any other core layer.
 */
export function coreBoundaries() {
  return defineConfig(
    {
      files: ['src/**/*.ts'],
      rules: { 'no-restricted-imports': ['error', platformRestriction] },
    },
    {
      files: ['src/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            ...platformRestriction,
            patterns: [
              ...PLATFORM_IMPORT_PATTERNS,
              {
                regex: '(^|/)(application|ports|protocol|crypto)(/|$)',
                message: 'domain/ is the innermost layer and must not import other layers.',
              },
            ],
          },
        ],
      },
    },
  );
}
