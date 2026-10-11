import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are listed as devDependencies, so electron-vite bundles them
// into main/preload instead of loading them from node_modules at runtime.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
