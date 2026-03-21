import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const repoName = 'prod-kanban' // ← замінити на назву репозиторію

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  base: process.env.GITHUB_PAGES === 'true' ? `/${repoName}/` : '/',
})
