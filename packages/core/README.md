# @clipbridge/core

Platform-neutral domain and application logic shared by the desktop and mobile apps: protocol, crypto, sync engine, pairing, connection diagnosis.

## Rules

- No platform imports (`node:*`, `electron`, `react-native`, `expo-*`, …). Platform features are reached through **ports** (interfaces) implemented by each app. Enforced by ESLint.
- `src/domain/` must not import any other layer.
- Apps import only from the package entry (`@clipbridge/core`).

The package is consumed as TypeScript source (no build step); each app's bundler compiles it.

## Scripts

| Command              | Does                                    |
| -------------------- | --------------------------------------- |
| `pnpm test`          | run unit tests                          |
| `pnpm test:coverage` | tests with coverage report              |
| `pnpm typecheck`     | type-check                              |
| `pnpm lint`          | lint, including architecture boundaries |
