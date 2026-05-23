import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { transformWithOxc } from 'vite';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'jsx-in-js-files',
      enforce: 'pre',
      transform(code, id) {
        if (!id.match(/[\\/]app[\\/].+\.js$/)) return null;

        return transformWithOxc(code, id, {
          lang: 'jsx'
        });
      }
    },
    react({
      include: /\.(js|jsx|ts|tsx)$/
    })
  ],
  resolve: {
    alias: {
      '@': dirname
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.js'
  }
});
