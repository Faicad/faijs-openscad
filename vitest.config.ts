import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // Self-alias: @faicad/faijs-openscad resolves to live source (not dist).
      { find: '@faicad/faijs-openscad', replacement: resolve(__dirname, 'src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
