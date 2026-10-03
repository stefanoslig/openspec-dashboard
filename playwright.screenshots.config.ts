import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Takes the pictures of the README from the built package, so run `npm run build` first.
export default defineConfig(base, {
  testMatch: 'readme-screenshots.ts',
  use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
});
