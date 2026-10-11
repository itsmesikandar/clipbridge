import { base, react } from '@clipbridge/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), react());
