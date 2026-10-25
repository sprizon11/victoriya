# Phase 7 — Landing page v2: modern, brand-blue, domain-ready

**Goal:** replace the current cream-and-navy landing page with a more modern, confident,
fully **brand-blue** marketing site for Victoria Garments (men's and women's wear
manufacturer, Tiruppur). Same facts, same enquiry form and backend, much better
design, layout, motion, accessibility and speed. Ready to sit on the owner's own
domain once it is bought (for example `victoriyagarments.com`), with the staff portal
on the same domain (`/production`, `/lots`, `/salary` and so on).

**Touches:** `frontend/src/landing/*`, `frontend/public/` (logo files, images,
`robots.txt`, `sitemap.xml`), `frontend/public/index.html`. **Must not change** any
authenticated page, the enquiry endpoint's rules, or the backend, except the optional
dynamic sitemap in section 9.

Read first: `AGENTS.md`, `docs/codex/01-landing-page.md` (rules and facts still apply),
`frontend/src/landing/content.js`, `frontend/public/landing/ASSETS.md`.

## 1. Non-negotiable rules (carry over from Phase 1)

1. **No fabricated business facts.** No founding year, client names, machine counts,
   capacity, certifications, awards, export markets, testimonials, prices or "years of
   experience". Unknowns stay as `TODO(owner)` in `content.js`, and a section whose
   data is empty is **not rendered** at all (no empty boxes, no "coming soon").
2. Copy stays in `content.js`. Components contain no hard-coded words except
   accessibility labels.
3. The page makes **no authenticated API call**. The only request is the existing
   public enquiry POST, with its honeypot, rate limit, length limits and plain-text
   handling unchanged (`backend/test_enquiries.py` must stay green, 48 checks).
4. Imagery is illustrative and labelled as such (keep the `imageNote`). Never imply
   the pictures show the real factory or products.
5. No new runtime dependency unless it is justified in the PR. Plain CSS and a little
   React are enough. No animation library, no carousel library.
6. Do not push to git. Commit locally on `main`, one commit per logical step.

## 2. Brand theme: the logo blue everywhere

The owner supplied the official logo sheet. The colours are fixed by it:

| Token | Value | Use |
|---|---|---|
| `--blue` | `#054594` (PANTONE 2945 C) | **The dominant colour.** Header, hero, section bands, footer, buttons, links |
| `--blue-900` | `#032E63` | Deep bands, hover on blue, text on light blue tints |
| `--blue-700` | `#0A5BBA` | Hover and focus accents on blue |
| `--blue-100` | `#D6E4F7` | Borders and soft fills on white |
| `--blue-50` | `#EEF4FC` | Alternate light section background |
| `--green` | `#00AD8D` (PANTONE 339 C) | Single accent: small highlights, icons, the stitch motif |
| `--green-on-blue` | `#6FE6CB` | Green **text** on blue (the brand green is too dark on blue for small text) |
| `--ink` | `#0E1B33` | Body text on light backgrounds |
| `--muted` | `#4B5A73` | Secondary text on white (checked 4.5:1 or better) |
| `--white` | `#FFFFFF` | Text on blue, cards |

Rules:

- **"Full blue theme":** the header, hero, the "How to start" band and the footer are
  solid `--blue`. Between them alternate `#FFFFFF` and `--blue-50`. No cream, beige or
  grey-green backgrounds. No purple, no gradients as decoration (a very subtle
  `--blue` to `--blue-900` vertical shade inside the hero is allowed, nothing else).
- Define every colour as a CSS custom property once, at the top of `landing.css`,
  and use only those. No literal hex values inside components.
- Check every text and background pair for **4.5:1** (3:1 for text 24px and up and for
  icons that carry meaning). White on `#054594` passes. Brand green on blue does
  **not** pass for small text, so use `--green-on-blue` there. Record the pairs you
  checked in the PR.
- The login page and staff portal keep their own theme; only update their logo if it
  is not already the official one.

### Logo

Use the vector files already in the repo: `frontend/public/victoria-logo-white.svg`
(for blue backgrounds, the owner's preferred version) and
`frontend/public/victoria-logo-color.svg` (for white backgrounds). Both are the
official horizontal logo with its leaf. Never stretch, recolour, outline or add
effects to it; keep clear space around it equal to the height of the leaf. Header
logo height about 40px desktop, 32px phone; footer 44px. Give the `<img>` its
`width` and `height` attributes and a real `alt` ("Victoria, irresistible fashion").
Also derive the favicon, `apple-touch-icon.png` and `manifest.json` icons from the
leaf mark on a `--blue` square, and set `<meta name="theme-color" content="#054594">`.

## 3. Design direction

Think **confident, clean, textile-led**: big type, generous space, blue as a bold
field of colour, with real craft details. One memorable idea, used with restraint:
**the stitch line**, a thin dashed rule (`1.5px dashed`, `--blue-100` on white and
`rgba(255,255,255,.35)` on blue) that separates sections and underlines headings,
like a seam. Use it as the only decorative motif. No stock-photo clichés, no emoji,
no fake badges, no counters that animate to invented numbers.

Type: keep **Outfit** (headings, matches the logo's rounded geometry) and **IBM Plex
Sans** (body), both from Google Fonts with `display=swap` and real fallback stacks.
Scale (desktop / phone): H1 `clamp(44px, 6vw, 88px)` weight 500, line-height 1.04,
letter-spacing `-0.03em`; H2 `clamp(32px, 3.6vw, 52px)`; H3 24px; body 17px / 1.65,
max line length 62 characters; small labels 12px uppercase with `0.14em` tracking.
Use `text-wrap: balance` on headings. Numbers in tabular figures.

Layout: 12-column grid, max content width 1240px, section padding `clamp(64px,9vw,120px)`
vertical, side gutter at least 20px (`max(20px, env(safe-area-inset-left))`).
Cards: 16px radius, 1px `--blue-100` border, no heavy shadows (one soft shadow on
hover only). Buttons: 48px high minimum, 12px radius, primary = white on blue band
or blue on white; secondary = outlined.

Search the design intelligence if you have the `ui-ux-pro-max` skill (it is a local
script): `search.py "garment apparel manufacturer B2B landing page premium modern"
--design-system --variance 6 --motion 4 --density 3`. Its output for this brief:
hero + value proposition + features + CTA pattern, 4.5:1 contrast on every button
label, visible focus, reduced-motion respected, no emoji icons, responsive at 375,
768, 1024 and 1440 widths. Treat that as a checklist; the brand tokens above win
over any palette it suggests.

## 4. Page structure (top to bottom)

Render order and what each section must contain. Copy comes from `content.js`; where
a line below is a suggestion, keep it general, not a claim.

1. **Skip link** ("Skip to content"), visible on focus.
2. **Header** (sticky, solid `--blue`, 72px): white logo left; centre nav (About, What
   we make, Our process, Contact) with an active-section underline in
   `--green-on-blue`; right: "Staff login" text link and a white "Request a quote"
   button. On phones: logo + a 44px menu button that opens a full-width sheet
   (focus trapped, Escape closes, body scroll locked), with the quote button inside.
3. **Hero** (full-bleed `--blue`, min-height about 640px, not 100vh): left, the eyebrow
   (`--green-on-blue`), H1 "Thoughtfully made. Ready to wear.", one-line intro, two
   buttons ("Request a quote", "Call us" which is a `tel:` link) and the phone number as
   text. Right: the hero image in a 24px-radius frame with a dashed stitch outline
   offset 12px, plus a small caption chip "Illustrative image". On phones the image
   goes below the text. Preload the hero image, `fetchpriority="high"`, explicit
   dimensions.
4. **Intro band** (white): three short value statements side by side with a simple
   line icon each (inline SVG, 1.75px stroke, `--blue`): for example "Men's and
   women's wear", "Made in Tiruppur", "Talk to us directly". General wording only.
5. **About** (`--blue-50`): two columns. Left the heading and two short paragraphs
   from `content.js`; right a framed texture image (`texture-knit`). Optional stat
   row **only if `content.stats` is non-empty**.
6. **What we make** (white): two large cards, Men's wear and Women's wear, image on
   top (4:5), title, one sentence, "Ask about this range" link to the contact form
   with the range pre-selected in the message field. Hover: image scales 1.03 over
   300ms, no layout shift.
7. **Our process** (`--blue`): heading on blue, then the five steps (Sampling, Cutting,
   Stitching, Finishing & checking, Packing) as a **horizontal stepper** with a dashed
   stitch line running through the step markers. Each step: image (4:3), title, one
   line. On phones it becomes a vertical timeline. This is the visual centrepiece:
   spend the polish here. Markers are real list items (`<ol>`), not numbered for
   decoration; the order is meaningful.
8. **How to start** (white): three steps for a buyer: "Send your requirements",
   "We get back to you", "Plan the sample together". Mark `TODO(owner): confirm this
   is how orders really begin` in `content.js` and keep wording non-committal (no
   turnaround times).
9. **Optional sections, rendered only when their data exists:** `stats`,
   `certifications`, `clients`, `markets`, `gallery` (real photos), `testimonials`.
   Build the components and a story-less default, but do not show them while empty.
10. **Contact** (`--blue-50`): left, heading, intro, address (if set), phone, email,
    WhatsApp (if set), hours (if set), "Find Tiruppur on the map" link; right, the
    enquiry form on a white card: Name, Company, Email, Phone, Message (labels above
    fields, never placeholder-only), honeypot, required markers, inline error under the
    field, a polite `aria-live` status, a disabled-with-spinner submit state, and the
    existing success and error messages. Submitting must not clear the form on error.
11. **Footer** (`--blue-900`): white logo, short line of contact text, nav links, the
    "Staff login" link, copyright, the image disclaimer. Dashed rule above it.

Add a thin **"Request a quote" bar** pinned to the bottom on phones after the user
scrolls past the hero (44px+ targets, respects the home-indicator safe area, hides
when the contact section is in view).

## 5. Imagery

- The 13 existing images in `frontend/public/landing/` use the older navy `#294F96`.
  Step 1: check them against the new `#054594` theme on the blue hero and process
  bands. If they clash, **regenerate** them (the prompts and constraints are in
  `ASSETS.md`; change the palette line to navy `#054594`, teal `#00AD8D` and warm white),
  keep the same no-people, no-text, no-logos rules, and update `ASSETS.md`.
- Export WebP (quality about 78) with a JPEG fallback, widths 640 / 960 / 1280 / 1920
  via `srcset` and `sizes`, `loading="lazy"` below the fold, explicit `width` and
  `height` on every image, `decoding="async"`. Hero under 200 KB at 1920 wide.
- Add `og-image.jpg` (1200x630): the white logo on `--blue`, nothing else.
- Alt text describes the picture honestly ("Illustrative ..."), decorative images get
  `alt=""`.

## 6. Motion

Subtle and purposeful, 200 to 400ms, `ease-out`. Allowed: section content fades and
rises 12px once when it enters view (IntersectionObserver, no library); hover and
focus transitions on buttons and cards; the mobile sheet slides in; the stepper's
dashed line draws left to right once. Everything must be visible with no animation
(the first still frame is complete, nothing waits at opacity 0), and
`prefers-reduced-motion: reduce` turns all of it off. No parallax, no auto-playing
carousel, no scroll-jacking, no looping animation.

## 7. Accessibility

WCAG 2.2 AA. One `<h1>`; headings in order; landmarks (`header`, `nav`, `main`,
`footer`); visible 3px focus ring in a colour that passes against both blue and white
(white ring with a blue offset on blue; blue ring on white); every control reachable
by keyboard; touch targets 44px or more; `lang="en"`; form errors linked with
`aria-describedby`; the mobile menu is a proper disclosure with `aria-expanded`. Run
an automated check (axe or Lighthouse) and fix everything it reports.

## 8. Performance and SEO

Targets on a mobile profile for the built site: Lighthouse Performance 90 or more,
Accessibility 100, Best Practices 100, SEO 100; LCP under 2.5s, CLS under 0.1.
The landing chunk stays lazy-loaded and separate from the staff app bundle. Inline
the critical CSS or keep one small stylesheet; fonts preconnected and `swap`. Per
page: unique `<title>` and meta description, `lang`, canonical link, Open Graph and
Twitter tags, JSON-LD `Organization` (and `LocalBusiness` only if address and phone
are confirmed) built **only from values that are set**.

## 9. Custom domain readiness

The owner will attach a domain later (for example `victoriyagarments.com`) on Render
and expects the landing page at the root and the portal on the same origin, so
`https://victoriyagarments.com/production` opens the staff app.

- Logged out, `/` shows the landing page; logged in, `/` shows the dashboard; `/home`
  always shows the landing page. Every portal path (`/production`, `/lots`, `/salary`,
  `/stock` ...) already works as a direct link because the server falls back to
  `index.html`. A logged-out visitor is sent to `/login` and returned to the page they
  asked for after signing in (already implemented; do not break it).
- Do not hard-code any domain. The canonical URL, Open Graph URLs and sitemap derive
  from one value: `content.canonicalUrl`, falling back to `REACT_APP_SITE_URL`
  at build time, falling back to omitting the tags. Better, add a small public
  FastAPI route `GET /sitemap.xml` and `GET /robots.txt` that build the sitemap and
  the `Sitemap:` line from the request's own host (honour `X-Forwarded-Proto` and
  `X-Forwarded-Host`), so nothing needs editing when the domain changes. The sitemap
  lists `/home` only.
- `robots.txt` must **disallow every portal path**, not just some. The current list is
  out of date. Disallow: `/login`, `/api/`, `/lots`, `/production`, `/weeks`,
  `/approvals`, `/stock`, `/purchase-orders`, `/salary`, `/advances`, `/payroll`,
  `/vouchers`, `/expenses`, `/reports`, `/operators`, `/operations`, `/colors`,
  `/size-charts`, `/rate-types`, `/users`, `/enquiries`, `/audit`, `/settings`,
  `/year-end`. Allow `/` and `/home`. Add `<meta name="robots" content="noindex">` to the
  staff app shell if you can do so without affecting the landing page.
- Add a short "Custom domain" section to `DEPLOY.md`: add the domain in Render, set
  the DNS records Render shows, wait for the certificate, then set `content.canonicalUrl`
  (or the env value) and redeploy.

## 10. Tests and definition of done

- [ ] `backend/test_enquiries.py` passes (48), plus `test_api.py` still passes.
- [ ] `cd frontend; npm run build` says "Compiled successfully" with no warnings.
- [ ] Add a small Jest test (or a script) that renders the landing with the
      repository's `content.js` and asserts: one `h1`; no section renders when its data
      array is empty; every image has `alt`; no literal hex colours in `landing.css`
      outside the token block.
- [ ] Manually checked at **390, 768, 1024 and 1440** widths, keyboard-only through the
      menu, the stepper and the form, and with reduced motion on. No horizontal
      scroll anywhere.
- [ ] Lighthouse mobile scores recorded in the PR (targets in section 8).
- [ ] Contrast pairs recorded in the PR.
- [ ] Logged-in staff can still reach `/`, `/home`, `/login` and every portal route.
- [ ] `ASSETS.md`, `README-LOCAL.md` and `DEPLOY.md` updated; `TODO(owner)` list in the
      PR: address, hours, WhatsApp, founding year, capacity, machines, workforce, markets,
      clients, certifications, real photos, testimonials, and the domain.
- [ ] One local commit per logical step. Do not push. Do not commit
      `frontend/package-lock.json` churn.
