# Phase 8 — Landing page v3: cinematic, image-rich, Framer Motion

**This replaces the look and layout of `07-landing-page-v2.md`.** From 07, keep only what is
already built and still correct: the content rules (section 1), the domain, sitemap and
`robots.txt` work (section 9), accessibility basics and the test list. **Ignore 07's
colour and layout sections.** They were misread.

## 0. What the owner said, and what was wrong

The owner reviewed Phase 7 on screen and said:

1. **The brand blue `#054594` belongs in the staff tool's side panel (Unit Flow), not on
   the website.** The sidebar is already done. **Do not touch `Layout.js`, the sidebar or
   any logged-in page.** The public site must not be a solid blue page.
2. The hero is weak: a flat blue field with one small picture.
3. The page needs **many more images**.
4. It should feel **cinematic**, using **Framer Motion** animation.

Phase 7's problems to remove: full-blue header, hero, process band and footer; a single
hero picture; only 9 illustrative images; plain CSS fades.

**Touches:** `frontend/src/landing/*`, `frontend/public/landing/` (new images),
`frontend/public/index.html` (only if needed), `frontend/package.json` (one new
dependency, below), `frontend/src/index.js` only if the lazy chunk needs it. **Must not
change** any authenticated page, `Layout.js`, the backend, or the enquiry endpoint rules.

Read first: `AGENTS.md`, `docs/codex/01-landing-page.md` (facts rules), `07` sections 1
and 9, `frontend/src/landing/content.js`, `frontend/public/landing/ASSETS.md`.

## 1. Non-negotiable rules (unchanged)

1. **No fabricated business facts.** No founding year, clients, machine counts, capacity,
   certifications, awards, markets, testimonials, prices or "years of experience".
   Unknowns stay `TODO(owner)` in `content.js`; a section with no data is not rendered.
2. All copy lives in `content.js`. Components hold no hard-coded words except accessibility
   labels.
3. No authenticated API call on the landing page. The enquiry POST keeps its honeypot,
   rate limit, length limits and plain text handling; `backend/test_enquiries.py` (48)
   stays green.
4. Every picture is illustrative and says so (keep the `imageNote` and the "Illustrative
   image" chip). Never imply it shows the real factory, staff or products.
5. Do not push to git. Commit locally on `main`, one commit per logical step. Do not commit
   `frontend/package-lock.json` churn except the deliberate dependency change.

## 2. The one allowed new dependency: Framer Motion

The owner asked for it explicitly, so it is justified (AGENTS rule 5). Install the
current **12.x** release of `framer-motion` (it supports React 19) with an **exact**
version in `frontend/package.json`, no caret. Rules to keep it light and safe:

- Import it **only inside `frontend/src/landing/`**, so it lives in the lazy landing chunk
  and never enters the staff app bundle. Verify with the build output.
- Use `LazyMotion` with `domAnimation` and the `m` components (not `motion`) to keep the
  runtime small. Load `domMax` features only if a layout animation truly needs them.
- Animate **only `transform` and `opacity`** (and `clip-path` for image reveals). Never
  animate width, height, top or left.
- Respect `useReducedMotion()`: with reduced motion the page shows its **final state with
  no movement**, no pinned scrolling, no parallax.
- **The first frame must be complete without JS animation finishing.** Never start the LCP
  element (hero image or headline) at `opacity: 0`. Animate the hero image's scale and
  the headline's *mask* (y-translate inside an overflow-hidden line), not its opacity.
  If JS fails, all content is still visible.
- Shared motion tokens in one file (`landing/motion.js`): ease `[0.22, 1, 0.36, 1]`, reveal
  duration 0.7s, stagger 0.08s, viewport `{ once: true, margin: "-12% 0px" }`. One reveal
  helper component (`<Reveal>`), not copy-pasted props.

## 3. Visual direction

**Cinematic, editorial, image-led.** Think a fashion-label brand film in web form: huge
type over full-bleed photography, dark ink-navy sections for drama, bright clean sections
for breathing room, and slow, confident motion. Blue appears only as a **brand accent**
(buttons, links, small marks, the logo), never as a page background.

Colour tokens (CSS custom properties, defined once at the top of `landing.css`):

| Token | Value | Use |
|---|---|---|
| `--ink` | `#07162B` | Cinematic dark sections, hero overlay, footer. Deep navy-black |
| `--ink-2` | `#0E2442` | Cards on dark |
| `--paper` | `#F6F8FB` | Light section background (cool, very light) |
| `--white` | `#FFFFFF` | Cards, text on dark |
| `--text` | `#0E1B33` | Body on light |
| `--muted` | `#4B5A73` | Secondary text on light (4.5:1 or better) |
| `--muted-on-dark` | `#B9C6DA` | Secondary text on dark (4.5:1 or better) |
| `--blue` | `#054594` | Primary buttons on light, links, logo colour on light |
| `--blue-on-dark` | `#7FB0F2` | Links and small marks on dark |
| `--green` | `#00AD8D` | Accent line, icons, tiny highlights |
| `--green-on-dark` | `#6FE6CB` | Green text on dark |

No cream, beige or olive. No purple. No gradient washes except the single dark gradient
that makes text readable over photography. Check every text and background pair for
4.5:1 (3:1 for text 24px and up) and record them in the PR.

Type: **Outfit** (display) and **IBM Plex Sans** (body), `display=swap`, real fallbacks.
Hero H1 `clamp(52px, 9vw, 150px)`, weight 500, line-height 0.98, tracking `-0.04em`;
H2 `clamp(36px, 5vw, 76px)`; body 17px / 1.65; labels 12px uppercase, tracking `0.16em`.
`text-wrap: balance` on headings. Max line length 62ch for paragraphs.

Motif: the **stitch line**, a thin dashed rule used as a divider and as a line that draws
itself in the process section. One motif only.

Logo: white version (`/victoria-logo-white.svg`) on the transparent header over the
hero and on dark sections; colour version (`/victoria-logo-color.svg`) once the header turns
solid white. Never recolour or distort it.

## 4. Images: add many more (target 30 or more files across the page)

Today there are 9. Create **at least 21 new illustrative images** with the built-in
`image_gen` tool, one request per scene, and keep the existing 9 where they still fit.
Common constraints for every prompt (as in `ASSETS.md`): premium editorial product
photography; soft natural light; shallow depth of field; a **navy, teal and warm white**
palette; photorealistic, no HDR; **no faces, no identifiable people** (hands only, from
behind, or no people), **no readable text, logos, brand names, labels, certification
badges, flags or copyrighted designs**; no specific building.

Needed (ratio in brackets; export each at 640, 960, 1280, 1920 wide as WebP plus JPEG
fallback; hero frames also at 2560):

| Group | Count | Subjects |
|---|---|---|
| Hero frames (16:9) | 3 | Wide cinematic frame of folded knit stacks in morning window light; industrial sewing line seen from a low angle with soft depth and no people; long cutting table with layered fabric receding into the distance |
| Men's wear (4:5 and 1:1) | 5 | Navy crew-neck flat lay; grey polo detail; folded tees stack; a hanging rail of plain shirts (no labels); a close crop of collar and stitching |
| Women's wear (4:5 and 1:1) | 5 | Teal and white tops flat lay; knit cardigan detail; hanging rail of plain dresses; folded lightweight tops; close crop of a seam |
| Fabric and detail (1:1 and 3:2) | 6 | Jersey knit macro; ribbed cuff; thread spools in navy, teal and white; buttons and a zip on plain fabric; needle on a seam; folded fabric edges |
| Process (4:3) | 5 | Refresh the existing five (sampling, cutting, stitching, finishing, packing) so they match the new set |
| Wide panorama (21:9) | 2 | A cinematic panorama of garment rails; a panorama of fabric rolls |

Total 26. Put the prompt set, size and file table in `ASSETS.md`. Hero frames and
panoramas must keep a calm, dark-friendly area for text (left or lower third).
Under 220 KB for any hero WebP at 1920; below-the-fold images lazy-loaded with explicit
`width` and `height` (no layout shift) and `decoding="async"`. Alt text honest and
specific ("Illustrative folded teal knit stack"); decorative images `alt=""`.
Open Graph image 1200x630: white logo centred on `--ink`.

## 5. Page structure and choreography (top to bottom)

Build these as separate components in `landing/sections/`. Where Framer Motion is named,
use it; "static" means no animation.

1. **Header.** Transparent, fixed over the hero, white logo, nav (About, What we make,
   Our process, Gallery, Contact), "Staff login" link, white "Request a quote" pill.
   After 80px of scroll it becomes solid white (colour logo, dark text) with a soft
   border, via `useScroll` and a state flag, not layout animation. Mobile: 44px menu button
   opening a full-screen dark sheet with `AnimatePresence` (links stagger in; focus trapped;
   Escape closes; body scroll locked).
2. **Hero (full viewport height, `100svh`).** Full-bleed hero image with the dark
   gradient overlay. Three hero frames **crossfade slowly (every 6s, 1.2s fade)**, each
   with a subtle 1.0 to 1.08 scale drift (ken-burns); paused for reduced motion (show the
   first frame). Centre-left: eyebrow, then the H1 revealed **line by line with a mask**
   (each line slides up from 110%), intro text and two buttons fading up in sequence
   after the headline. Bottom: a thin "Scroll" cue with a line that pulses, plus the
   "Illustrative image" chip. **Scroll-linked:** as the user scrolls through the hero, the
   image translates up 12% (parallax), the overlay darkens, and the headline drifts up and
   fades, via `useScroll` + `useTransform`.
3. **Statement band (dark, `--ink`).** One large sentence from `content.js`, revealed
   **word by word, scroll-linked** (each word's opacity maps to scroll progress from 0.25
   to 1). Below it a stitch line that draws left to right.
4. **About (light, `--paper`).** Two columns. Text reveals with the helper; right side a
   tall image with a **clip-path reveal** (inset 100% to 0%) and a second smaller image
   overlapping it, moving at a different parallax speed. Optional stats row only when
   `content.stats` is non-empty.
5. **Collections (light).** Men's wear and Women's wear as two **large, tall cards**. Each
   has a main image, a hover state where the image scales 1.04 and a second image fades in,
   a title, one sentence and an "Ask about this range" arrow link to the form with the
   range pre-filled. Cards enter with staggered clip-path reveals.
6. **Image reel (dark).** A **horizontal scroll-linked strip** of 8 to 10 photographs
   (fabric details, rails, panoramas) that slides sideways as the page scrolls
   (`useScroll` mapped to `x`), each picture at a slightly different speed. On phones and
   with reduced motion it becomes a normal swipeable row (CSS scroll-snap).
7. **Process (dark, pinned).** The five steps as a **pinned horizontal story**: the
   section is `sticky` for 5 viewport heights; scroll progress moves a track sideways so each
   step's large image and text takes the screen in turn; a dashed stitch line at the bottom
   **draws itself** (`pathLength`) and a numbered marker lights up for the active step.
   Steps are a real ordered list; each step's text is readable without animation. On phones
   and reduced motion: a plain vertical list with a vertical stitch line.
8. **Gallery (light) — "A closer look".** A **bento grid** of 8 images in mixed sizes
   with staggered reveals and a hover lift. Clicking an image opens a **lightbox** with
   `AnimatePresence` (arrow keys and Escape work, focus is trapped and returned). Labelled
   illustrative. If `content.gallery` holds real photos later, they replace these.
9. **How to start (light).** Three steps, "Send your requirements", "We get back to you",
   "Plan the sample together", with the stitch line connecting them. Keep the
   `TODO(owner)` note in `content.js`. No turnaround times.
10. **Contact (dark, `--ink`).** Large heading, address, phone, email, WhatsApp and hours
    (each only if set), map link. The form sits on a white card. Fields stagger in once; the
    success state shows an animated check and the success message; errors are linked to
    their field with `aria-describedby` and announced politely. The form never clears on
    error. Submit shows a spinner and is disabled while sending.
11. **Footer (`--ink`).** A very large wordmark (the white logo, scaled up and cropped at
    the bottom edge) that rises into view, a short line, nav links, "Staff login",
    copyright, the image disclaimer.

Also: a **sticky "Request a quote" pill** on phones after the hero, hidden while the
contact section is visible; respects the safe-area inset.

Optional sections stay data-driven: `stats`, `certifications`, `clients`, `markets`,
`testimonials`, real `gallery`. Render only when the array is non-empty.

## 6. Performance budget (cinematic must still be fast)

Mobile Lighthouse: Performance **85 or more**, Accessibility **100**, Best Practices
**100**, SEO **100**. LCP under 2.8s on the mobile profile, CLS under 0.1. The landing
chunk stays lazy and separate; **gzipped landing JS under 150 KB including Framer
Motion** (report the number). Preload only the first hero frame; the other frames and all
below-the-fold images lazy-load. No autoplaying video (a still-image crossfade is the
"film"). No heavy WebGL. Pause the hero crossfade when the tab is hidden or the hero is
off screen. Do not run animations on elements that are off screen.

## 7. Accessibility

WCAG 2.2 AA. One `h1`; ordered headings; landmarks; visible focus rings that pass on both
dark and light surfaces; every control keyboard operable (menu, lightbox, form);
touch targets 44px or more; `lang="en"`. **Motion safety:** `prefers-reduced-motion`
disables crossfade, parallax, pinned scrolling, word reveals and drawing lines (final state
shown). Nothing flashes more than three times a second. A "Pause motion" control is not
required if reduced motion is honoured, but nothing may auto-advance faster than 6 seconds
or without a still fallback. Run axe or Lighthouse and fix everything.

## 8. Domain readiness (already built, do not regress)

Keep the existing domain-aware `robots.txt` and `sitemap.xml`, the canonical and Open
Graph handling, the post-login redirect to the page the visitor asked for, and the rule
that logged-out `/` shows the landing page, logged-in `/` the dashboard, and `/home`
always the landing page. Portal paths such as `/production` must still work as direct
links on the same origin. Update the Open Graph image only.

## 9. Tests and definition of done

- [ ] `backend/test_enquiries.py` (48) and `backend/test_api.py` pass with the API running.
- [ ] `cd frontend; npm run build` says "Compiled successfully", no warnings; report the
      gzipped size of the landing chunk and confirm Framer Motion is **not** in the main
      staff bundle.
- [ ] Update `frontend/src/landing/LandingPage.test.js`: one `h1`; empty optional sections
      do not render; every image has `alt`; no literal hex colours in `landing.css`
      outside the token block; with reduced motion mocked, content is present with no
      transform styles applied.
- [ ] Manual checks at **390, 768, 1024, 1440 and 1920** widths, keyboard-only through the
      menu, lightbox and form, with reduced motion on and off. No horizontal scroll.
- [ ] Screenshots of hero, statement band, process step 3 and the gallery at 390 and 1440,
      attached to the PR.
- [ ] Lighthouse mobile scores, contrast pairs and the `TODO(owner)` list in the PR.
- [ ] `ASSETS.md`, `README-LOCAL.md` updated.
