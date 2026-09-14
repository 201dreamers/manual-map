import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The app bundle is a little over 2 MB, above Workbox's default precache ceiling.
 * Without raising it the main chunk is silently skipped and the installed app
 * fails to start offline.
 */
const PRECACHE_FILE_LIMIT_BYTES = 6 * 1024 * 1024

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Manual Map - Route Simulator',
        short_name: 'Manual Map',
        description:
          'Build driving routes and simulate movement along them with step and speed controls.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#020617',
        theme_color: '#020617',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: PRECACHE_FILE_LIMIT_BYTES,
        // Mapbox tiles and API responses are deliberately left uncached: their
        // terms restrict offline storage, and stale routing data would mislead.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
