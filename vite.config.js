import { defineConfig } from 'vite'

export default defineConfig({
  // Base da URL no GitHub Pages
  base: '/contador.io.github/',

  build: {
    outDir:     'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Three.js em chunk separado (evita bloquear o carregamento inicial)
        manualChunks: {
          three: ['three'],
        }
      }
    }
  },

  server: {
    port: 3000,
    open: true
  },

  // Assets estáticos que não precisam ser processados
  assetsInclude: ['**/*.mp3', '**/*.jpg', '**/*.jpeg', '**/*.svg', '**/*.png']
})
