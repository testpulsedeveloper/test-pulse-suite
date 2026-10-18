import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;
        return transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        });
      },
    },
    react(),
  ],
  define: {
    global: 'window',
    'process.env': {},
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdf.worker')) return 'pdfjs-worker';
            if (id.includes('pdfjs-dist')) return 'pdfjs';
            if (id.includes('@atlaskit/')) return 'atlaskit';
            if (id.includes('@forge/')) return 'forge';
            if (id.includes('@tanstack/')) return 'query';
            return 'vendor';
          }
        },
      },
    },
  },
  optimizeDeps: {
    force: true,
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});
