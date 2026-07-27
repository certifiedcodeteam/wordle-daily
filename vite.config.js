import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      base44({
        // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
        // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
        legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
        hmrNotifier: true,
        navigationNotifier: true,
        analyticsTracker: Boolean(process.env.VITE_BASE44_APP_ID || process.env.BASE44_APP_ID),
        visualEditAgent: true
      }),
      react(),
    ],
    ...(env.VITE_BASE44_APP_BASE_URL ? {
      server: {
        proxy: {
          '/api': {
            target: env.VITE_BASE44_APP_BASE_URL,
            changeOrigin: true,
            ws: true,
          },
          '/ws-user-apps': {
            target: env.VITE_BASE44_APP_BASE_URL,
            changeOrigin: true,
            ws: true,
          },
        },
      },
    } : {}),
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'ui-vendor'
            if (id.includes('react') || id.includes('@tanstack') || id.includes('framer-motion')) return 'react-vendor'
            if (id.includes('recharts') || id.includes('three') || id.includes('html2canvas')) return 'rich-vendor'
            return undefined
          },
        },
      },
    },
  }
});
