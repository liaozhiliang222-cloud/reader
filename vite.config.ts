import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { productionSecurity } from './scripts/security-policy.ts';

export default defineConfig({
  plugins: [
    productionSecurity(),
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      includeManifestIcons: false,
      devOptions: { enabled: false },
      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,png,svg,webmanifest}',
          'licenses.txt',
          'fonts/OFL.txt',
        ],
        rollupFormat: 'iife',
      },
      manifest: {
        id: './',
        name: '静页 · 安静阅读',
        short_name: '静页',
        description: '书籍、进度与笔记只在本机，随时离线阅读。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F5F0E6',
        theme_color: '#F5F0E6',
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: [
                  '.epub',
                  '.txt',
                  '.md',
                  '.markdown',
                  'application/epub+zip',
                  'text/plain',
                  'text/markdown',
                  'text/x-markdown',
                ],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: './#/incoming',
            accept: {
              'application/epub+zip': ['.epub'],
              'text/plain': ['.txt'],
              'text/markdown': ['.md', '.markdown'],
              'text/x-markdown': ['.md', '.markdown'],
            },
          },
        ],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
      { find: /^dexie$/, replacement: 'dexie/dist/modern/dexie.mjs' },
    ],
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: ['es2022', 'safari16.4'] },
});
