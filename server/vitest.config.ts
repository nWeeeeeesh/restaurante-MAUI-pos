import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    // Días locales de Lima en cualquier máquina (los datos simulados y el export dependen de eso)
    env: { TZ: 'America/Lima', NIGHTLY_JOBS: 'off' },
  },
})
