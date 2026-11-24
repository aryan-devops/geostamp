import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/leaflet/')) return 'leaflet';
          if (id.includes('/node_modules/jszip/') || id.includes('/node_modules/exifr/') || id.includes('/node_modules/pako/')) return 'image-tools';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react';
        },
      },
    },
  },
});
