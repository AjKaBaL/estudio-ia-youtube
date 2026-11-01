import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Bibliotecas do Google/YouTube só podem ser usadas dentro de packages/youtube.
const restricaoYouTube = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['googleapis', '@googleapis/*', 'google-auth-library'], message: 'Acesso ao YouTube só dentro de packages/youtube.' },
        { group: ['**/packages/youtube/src/*'], message: 'Importe apenas de "@estudio/youtube".' }
      ]
    }
  ]
}

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Com noUncheckedIndexedAccess ativo, a asserção "!" é usada de forma deliberada após checagens de índice.
  { rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }] } },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: restricaoYouTube
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  }
)
