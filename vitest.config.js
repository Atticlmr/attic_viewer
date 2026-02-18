import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.js', 'src/**/*.spec.ts', 'src/**/*.spec.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'public/',
        '**/*.config.js',
        '**/*.test.js',
        '**/*.spec.js',
      ],
    },
    setupFiles: ['./src/test/setup.ts'],
  },
});
