import { defineConfig } from 'vite'

export default defineConfig({
  // Base da URL no GitHub Pages
  base: '/contador.io.github/',

  build: {
    outDir:     'dist',
    emptyOutDir: true
  },

  server: {
    port: 3000,
    open: true
  },

  // Assets estáticos que não precisam ser processados
  assetsInclude: ['**/*.mp3', '**/*.jpg', '**/*.jpeg', '**/*.svg', '**/*.png']
})
