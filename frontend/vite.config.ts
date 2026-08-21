import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Relative assets work on both a GitHub Pages project site and a custom domain.
  base: mode === 'production' ? './' : '/',
}))
