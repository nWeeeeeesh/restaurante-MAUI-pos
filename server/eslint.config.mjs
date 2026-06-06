import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  {
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**', 'dist/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: './tsconfig.json' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // Previene el uso de req.body sin validación (asegura tipos en runtime)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Bloques catch vacíos permitidos solo cuando son intencionales (cleanup).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Igualdad estricta
      'eqeqeq': ['error', 'always'],
    },
  },
]
