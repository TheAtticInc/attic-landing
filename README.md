# attic-landing

Marketing site served at [heyattic.com](https://www.heyattic.com) (canonical since 2026-07-09; attic.it.com 308-redirects here). The app itself lives at [app.attic.it.com](https://app.attic.it.com).

- Built with [Astro](https://astro.build) — `.astro` pages compile to static HTML.
- Deployed to Vercel automatically on push to `main`.
- Pages: `/` (landing), `/denver`, `/privacy`, `/termsofservice`.

## Editing

- `src/pages/index.astro` — landing page
- `src/pages/denver.astro` — Denver service-area page
- `src/components/Nav.astro` and `Footer.astro` — shared chrome
- `src/layouts/BaseLayout.astro` — `<head>` / SEO / JSON-LD
- `src/styles/*.css` — global tokens + page-scoped CSS
- `public/scripts/motion.js` — vanilla JS for reveal-on-scroll, ticker, phone-stack cycle, email form

```sh
npm install
npm run dev      # local at http://localhost:4321
npm run build    # outputs to dist/
```

## Related

- App (private): [TheAtticInc/attic-dev](https://github.com/TheAtticInc/attic-dev)
