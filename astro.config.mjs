import { defineConfig } from 'astro/config';

// https://astro.build/config
// Sitemap is hand-maintained at public/sitemap.xml — five pages,
// not worth the @astrojs/sitemap integration (which doesn't play well
// with `format: 'file'` URLs).
export default defineConfig({
  site: 'https://attic.it.com',
  build: {
    format: 'file', // produces /privacy.html, /denver.html — matches the mocks' expected URLs
  },
  compressHTML: true,
});
