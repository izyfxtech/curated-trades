import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Move specific UI components into the 'ui' chunk
          if (id.includes('@radix-ui/react-')) {
            return 'ui';
          }
          // Move recharts into the 'charts' chunk
          if (id.includes('node_modules/recharts')) {
            return 'charts';
          }
          // Move supabase into the 'supabase' chunk
          if (id.includes('@supabase/supabase-js')) {
            return 'supabase';
          }
          // Move core React libraries into the 'vendor' chunk
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/')
          ) {
            return 'vendor';
          }
        },
      },
    },
  },
})

