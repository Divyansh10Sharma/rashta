import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    languageOptions: {
      parserOptions: {
        // eslint.config.js and the build scripts live outside tsconfig's
        // `include`, so the project service needs to be told they are allowed
        // to fall back to the default project.
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md code standards: no `any`, no non-null assertions, and
      // @ts-ignore needs an adjacent explanation.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // CLAUDE.md rule 4. All randomness goes through the seeded RNG, so this is
  // the one file allowed to call Math.random.
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'CLAUDE.md rule 4: the simulation is deterministic. Use the seeded RNG in src/core/rng.ts.',
        },
      ],
    },
  },
  { files: ['src/core/rng.ts'], rules: { 'no-restricted-properties': 'off' } },

  // CLAUDE.md rule 1. Core is pure TypeScript: it is what makes the
  // simulation testable and deterministic, and it cannot survive one
  // convenient import of three.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                'CLAUDE.md rule 1: src/core/ is pure TypeScript. World space is computed at render time.',
            },
          ],
          patterns: [
            {
              group: ['**/render/**', '**/input/**', '**/audio/**', '**/ui/**'],
              message:
                'CLAUDE.md rule 1: core may not import from render, input, audio, or ui.',
            },
          ],
        },
      ],
    },
  },

  // Config files and build scripts run in Node and are not part of the game.
  // Spread disableTypeChecked's rules rather than replacing them — a bare
  // `rules` key after the spread silently drops all ~50 of its opt-outs.
  {
    files: ['*.config.ts', 'eslint.config.js', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Declared by hand rather than pulling in the `globals` package for two
      // names — CLAUDE.md asks for every runtime dependency to earn its place,
      // and dev dependencies are not free either.
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
);
