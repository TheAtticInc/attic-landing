# attic-landing photography slots

Three image slots are wired into the site. When a file exists at the listed
path, the placeholder treatment is replaced automatically. Until it lands,
the slot renders as an intentional brand-color frame (sage / cream / soft
inner shadow) — no broken-image icons.

Drop the final asset at the listed path, commit, and Vercel redeploys.

## 1. Hero anchor — `/images/hero.jpg`

**Slot:** right column of the hero, above-the-fold. The single most important
image on the site.

**Brief:** one warm interior frame, single subject, intentional negative
space. The whole brand thesis ("absence of clutter, not addition of storage")
should land in a glance. Ideas:

- A bright apartment corner with morning light — clean floor, one piece of
  furniture, a single decorative object. Negative space is the subject.
- A folded set of off-season clothes on a wooden bench by a window, soft
  shadows from blinds.
- A small entryway with nothing on the floor, a single rug, sage wall.

**Avoid:** stock-photo "happy woman holding box" energy. Magazine-staged
maximalism. Anything with a child, pet, or partner in frame. Storage-unit
imagery.

**Specs:**
- Format: JPG (or AVIF/WebP — name accordingly and update `src` in
  `src/pages/index.astro` hero figure)
- Aspect ratio: 4:5 (portrait). The slot is 4/5 with `object-fit: cover`,
  so anything close works.
- Resolution: 1600×2000 px target, 1200×1500 minimum.
- Color: terracotta + sage palette ideal. Warm-cream-leaning if not.
- File size: under 300 KB after compression.

**Unsplash search starters (Luke to curate):**
- `https://unsplash.com/s/photos/empty-apartment-morning-light`
- `https://unsplash.com/s/photos/minimal-interior-warm`
- `https://unsplash.com/s/photos/quiet-corner-window`

## 2. Crate product photo — `/images/crate.jpg`

**Slot:** left column of the "One container, considered" section, next to
the spec grid.

**Brief:** a clean product photo of one Attic crate (the MilkCratesDirect
XLT271712). Empty, lid optionally off. Shot on a cream linen / pale wood
background. One shot, no styling props, no busy fabric.

**Avoid:** the crate stacked, photographed inside a warehouse, in a vehicle,
on a sidewalk. Keep it studio-clean.

**Specs:**
- Aspect ratio: 5:4 (landscape-ish). `object-fit: cover` will crop the rest.
- Resolution: 2000×1600 px target.
- File size: under 200 KB.

**Path forward:** waitlist phase doesn't require a real shot — the gradient
placeholder is fine. Post-launch, do a 15-minute studio shoot with one
crate, one tabletop, north-facing window. We own the photo permanently.

## 3. Founder photo — `/images/founder.jpg`

**Slot:** `.founder__photo` div in the "A note from the founder" section.
Currently a CSS placeholder treatment with "Photo placeholder — swap for
Luke" text overlay. (Wired via CSS background — see `landing.css` near
`.founder__photo`.)

**Brief:** one photo of Luke. Warm, lived-in. Outdoor / indoor both fine.
Flannel-not-polo, per brand direction. Single subject, soft natural light.

**Specs:**
- Aspect ratio: ~4:5 portrait.
- Square framing also works (CSS can crop).
- File size: under 200 KB.

**To wire it up:** drop `founder.jpg` into `public/images/`, then update
`.founder__photo` CSS in `landing.css` from the current placeholder
treatment to `background-image: url('/images/founder.jpg')`.

## License notes

If sourcing from Unsplash / Pexels, the photographer doesn't strictly
require attribution but it's a kind gesture. Consider a `// photo by X`
note in this README when each lands. For commissioned originals, no
attribution needed — we own the asset.

## Post-Maddie meeting

Per project memory, brand-asset execution is paused until Luke's meeting
with Maddie (~2026-05-21). The placeholder treatments are intentionally
brand-neutral so we can swap in whatever direction lands from that meeting
without re-engineering the markup.
