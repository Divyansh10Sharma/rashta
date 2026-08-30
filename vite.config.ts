import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Fail loudly rather than silently shipping a bundle over the standing
    // 500 KB gzipped budget — scripts/check-bundle-size.mjs is the real gate,
    // this is just the earlier warning.
    chunkSizeWarningLimit: 600,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Most of this suite is whole races simulated at 60 Hz, which is entirely
    // CPU-bound. Vitest's default is one worker per core less one, and on an
    // eight-core machine that saturates it completely — which made every
    // wall-clock assertion in the suite fail while passing on its own. Leaving
    // half the machine idle costs some wall time and buys measurements that
    // mean something. See devlog phase-07.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only core is held to a coverage bar; render, input, and ui are
      // exercised by hand and by eye, not by unit tests.
      include: ['src/core/**/*.ts'],
      thresholds: {
        // CLAUDE.md rule 6. See docs/devlog/phase-00.md on the empty-glob
        // behaviour while src/core/ is still empty in Phase 0.
        'src/core/**/*.ts': { lines: 80 },
        'src/core/track/**/*.ts': { lines: 100 },
      },
    },
  },
});
