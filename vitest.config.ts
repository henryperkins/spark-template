import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'dist/**',
        'src/components/**', // UI components - better tested with E2E
        'src/worker/index.ts', // Worker entry point
        'vite.config.ts',
        'vitest.config.ts'
      ],
      thresholds: {
        lines: 40,
        functions: 60,
        branches: 55,
        statements: 40
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
