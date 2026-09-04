import coreWebVitals from 'eslint-config-next/core-web-vitals';
import next from 'eslint-config-next';
import typescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...next,
  ...coreWebVitals,
  ...typescript,
  // Last: turns off stylistic rules that would fight Prettier.
  prettier,
  {
    rules: {
      // A leading underscore is how this project marks a binding that exists
      // only to be destructured away.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];

export default eslintConfig;
