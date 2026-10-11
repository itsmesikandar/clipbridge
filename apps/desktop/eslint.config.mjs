import { base, react } from '@clipbridge/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig(base({ tsconfigRootDir: import.meta.dirname }), react(), {
  // The renderer is untrusted web content: it reaches the system only via the preload API.
  files: ['src/renderer/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: '^(electron|node:)|(^|/)(main|preload)(/|$)',
            message:
              'Renderer must use window.clipbridge (preload API), not Electron/Node directly.',
          },
        ],
      },
    ],
  },
});
