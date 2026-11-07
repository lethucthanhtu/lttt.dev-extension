import { defineConfig } from 'vitest/config';

// Unit tests only; kept apart from vite.config.ts (crx, zip) on purpose.
export default defineConfig({
	test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
