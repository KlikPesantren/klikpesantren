import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import productionBuildEnv from './scripts/production-build-env.cjs'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    productionBuildEnv.validateProductionApiBase(process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL)
  }
  return {
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  }
})
