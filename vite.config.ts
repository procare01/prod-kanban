import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoName = 'prod-kanban' // ← замінити на назву репозиторію

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? `/${repoName}/` : '/',
})
