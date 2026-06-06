import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Pre-existente: catch handlers de axios usan any intencionalmente.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Zustand llama set() dentro de socket.on() registrado en useEffect — patrón válido.
      'react-hooks/set-state-in-effect': 'warn',
      // Los stores exportan funciones utilitarias junto al hook — intencional.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
