import { base, coreBoundaries } from '@clipbridge/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), coreBoundaries());
