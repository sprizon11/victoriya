# Phase 1 — Public landing page + imagery

**Goal:** a fast, credible, mobile-first marketing site for Victoria Garments
(men's and women's wear manufacturer, Tiruppur) served by the same app, with all
imagery produced as part of the task.

**Touches:** `frontend/src/App.js`, new `frontend/src/landing/`, `frontend/public/`
(images, `robots.txt`, `sitemap.xml`), `frontend/public/index.html`, and one small
public endpoint in the backend. **Must not change** any authenticated page.

## 1. Routing (low-risk approach)

- `/` -> **landing page when logged out**, existing dashboard when logged in
  (`AppRoutes` already knows `user`). Also expose it at `/home` for everyone so
  staff can still view it.
- Landing navbar has a "Staff login" button -> `/login`. `LoginPage` already
  redirects authenticated users to `/`.
- Lazy-load it: `const Landing = React.lazy(() => import('./landing/LandingPage'))`
  inside `<Suspense>`, so the factory app bundle does not grow and vice versa.
- The landing page must not call any authenticated API on load. `AuthContext`
  calls `/auth/me`; make sure a 401 there does not flash the "Loading…" screen
  over the landing page for logged-out visitors longer than necessary.
- The server already falls back to `index.html` for unknown paths, so no backend
  routing change is needed. Add `robots.txt` and `sitemap.xml` to
  `frontend/public/` (they are served as real files by `serve_spa`). Disallow
  `/login` and all app paths in `robots.txt`.

## 2. Content — facts vs placeholders

Put **all** copy and contact data in `frontend/src/landing/content.js`. One file,
so the owner can edit text without touching components.

**Owner decision: use general wording.** Where a fact is unknown, write safe,
generic copy with no specific claim rather than leaving a gap — e.g. "Quality
garments, made in Tiruppur" — and still keep every unknown as a `TODO(owner)` in
`content.js`. General wording must not imply capacity, certifications, history or
clients. Hosting stays on Render (Cloudflare migration is a separate, later task).

**Verified enough to use** (from the owner's own app + public listings):

- Name: Victoria Garments · Tiruppur, Tamil Nadu, India · tagline in the app:
  *"Irresistible Fashion"* (present in the logo artwork).
- Positioning: manufacturer and supplier of **men's wear and women's wear**
  (LinkedIn headline), apparel manufacturer and exporter (public listings).
- Phone `+91 421 24 79 137` (same as `COMPANY.phone` in `server.py`,
  written `0421-2479137`).
- Email `info@victoriagarments.in`.

**Conflicting / unverified — render the section only if the value is set, and
leave a `TODO(owner)` comment:**

- Postal address: Google summary says `#4/316-1A, Sri Nagar, Kumarasamy Nagar
  (East), Pitchampalayam Pudur (PO), Tirupur – 641603`; `server.py COMPANY` says
  `317/4b,4c,Sri Nagar…`. Use a single `address` field, default to the one in
  `server.py` **and print `TODO(owner): confirm address` in the PR**.
- "Founded 1970" appeared in a Google AI summary only. **Do not publish a founding
  year** until the owner confirms.
- Product categories beyond "men's wear / women's wear", fabrics (cotton hosiery,
  knit), capacity (pieces/month), machine count, workforce, certifications
  (GOTS, OEKO-TEX, WRAP, BSCI, ISO), export markets, client names, awards,
  testimonials. **All unknown. Default to omitted**, not invented. Provide empty
  arrays in `content.js` and have the components hide an empty section entirely.
- Map: embed Google Maps only with a confirmed address; otherwise a "Get
  directions" link.

The existing public site (the "Official Website" link in the Google panel) may be
read for facts to **ask the owner about**. Do not copy its text or images.

## 3. Page structure

One page, anchored sections, sticky translucent navbar (logo left, links, a
"Request a quote" button, "Staff login" as a quiet text link).

1. **Hero** — headline (e.g. "Men's & women's wear, made in Tiruppur"), one
   sentence, two CTAs (Request a quote · Call), hero image, slow parallax-free
   subtle motion only. Logo: `victoria-logo-blue.jpg` / `victoria-logo-mark-blue.png`
   already exist in `public/`.
2. **About** — 2 short paragraphs from confirmed facts; stat tiles only for
   values present in `content.js`.
3. **What we make** — Men's wear · Women's wear cards (image + 1 line). More
   cards only if the owner supplies them.
4. **How we work** — the real production flow shown as a 5-step timeline:
   Sampling -> Cutting -> Stitching -> Finishing & checking -> Packing.
   (Generic garment flow; wording must not claim capabilities like printing or
   embroidery.)
5. **Quality & compliance** — hidden unless `certifications.length > 0`.
6. **Gallery** — hidden unless images are provided; see Section 5.
7. **Request a quote / Contact** — form + address, phone, email, hours (only if
   set), WhatsApp button if a number is set.
8. **Footer** — logo, copyright `© <current year> Victoria Garments`, links.

Design: reuse the app's tokens — navy `#294F96`, leaf teal `#00AF92`, Outfit for
headings, IBM Plex Sans for body (already loaded in `index.css`). Generous
whitespace, large type, one accent colour per section, no stock-photo clichés.
Subtle scroll-reveal (opacity/translate only, 300–500 ms), disabled under
`prefers-reduced-motion` (the global rule in `index.css` already neutralises
animation; verify it covers your classes).

## 4. Enquiry form (the only public write endpoint)

Fields: name*, company, email*, phone, message* (max 1,500 chars), plus an
invisible honeypot `website`. Backend:

- `POST /api/public/enquiry` — **no auth**, stored in `enquiries`
  (`created_at`, `ip`, `user_agent`, `status: "new"`), HTML-escaped on render.
- Rate limit: max 5 per IP per hour via a `rate_limits` collection with a TTL
  index (follow the `login_attempts` pattern). Reject honeypot hits with a fake
  200. Pydantic length limits. Return a generic message.
- Admin sees enquiries on a small `/enquiries` page (admin only) with
  new/handled status; unread count joins the existing `notifications` feed.
- Email forwarding is added in Phase 5; until then notifications only. If
  `SMTP_*` is unset the endpoint must still work.
- Add test assertions: valid submit, honeypot, over-length, 6th submission -> 429.

## 5. Image production (Codex generates these)

Create `frontend/public/landing/` and the assets below. Produce each as **WebP**
(quality ~78) plus a JPG fallback for the hero, at the listed width and a 2x
variant for the hero only. Budget: hero ≤ 250 KB, every other image ≤ 120 KB,
total first-load images ≤ 900 KB. Use `loading="lazy"`, explicit `width/height`
(no layout shift), meaningful `alt`.

**House style (apply to every prompt):** premium editorial product photography,
soft natural window light, shallow depth of field, calm and uncluttered, colour
grade leaning to the brand navy (#294F96) and teal (#00AF92) with warm neutral
whites; photoreal, no HDR look.

**Hard constraints for every generated image:**

- No human faces or recognisable people (hands/silhouettes from behind are fine).
- No readable text, no logos, no brand names, no fake labels or certification
  badges, no flags.
- Do not depict a specific factory building or claim it is Victoria's premises.
  These are **illustrative** images; the owner should replace them with real
  photographs when available (the layout must work with either).
- No copyrighted characters or designs; garments are plain/neutral.

| File | Size | Used for | Prompt seed |
|---|---|---|---|
| `hero.webp/.jpg` (+`@2x`) | 1920×1080 | Hero background | Macro of folded cotton knit fabric stacks in navy, white and soft teal on a pale table, fabric weave visible, a few spools of thread, window light from the left, lots of negative space on the left for headline text |
| `mens-wear.webp` | 960×1200 | Men's wear card | Plain navy crew-neck t-shirt and a folded grey polo flat-lay on pale linen, overhead, no logos |
| `womens-wear.webp` | 960×1200 | Women's wear card | Folded teal and white women's tops and a lightweight knit cardigan flat-lay, overhead, soft shadows, no logos |
| `process-sampling.webp` | 800×600 | Timeline step 1 | Close-up, no people: pattern paper, tailor's chalk and measuring tape on a cutting table |
| `process-cutting.webp` | 800×600 | Step 2 | Layered fabric on a long cutting table with a straight-edge and shears, shallow focus |
| `process-stitching.webp` | 800×600 | Step 3 | Close-up of an industrial sewing machine needle stitching a knit hem, no operator face |
| `process-finishing.webp` | 800×600 | Step 4 | Neatly checked garments on a table, a thread-snipping scissor and a measuring tape |
| `process-packing.webp` | 800×600 | Step 5 | Folded garments stacked into a plain cardboard carton with tissue paper, no print on the box |
| `texture-knit.webp` | 1600×600 | Section divider | Abstract extreme macro of navy jersey-knit loops, very soft focus edges |
| `og-image.jpg` | 1200×630 | Social share card | Hero crop with the logo mark composited bottom-left; this one **may** contain the logo only |
| `favicon` set | 32/180/192/512 | Browser/PWA | Derived from `victoria-leaf.png` / `victoria-logo-mark.png`; keep `manifest.json` consistent |

Also hand-draw (SVG, not generated): a small leaf/needle/thread line-icon set
(`icon-needle.svg`, `icon-scissors.svg`, `icon-box.svg`, `icon-check.svg`,
`icon-map.svg`) in 1.5 px strokes using `currentColor`. Lucide icons already in
the project are acceptable instead — prefer them.

Record how each image was produced in `frontend/public/landing/ASSETS.md` (tool,
prompt, date) so it can be regenerated or replaced.

## 6. SEO, performance, accessibility

- `public/index.html`: `<title>Victoria Garments — Garment manufacturer in
  Tiruppur</title>` (the in-app title can be set per-route in JS), a meta
  description, canonical, Open Graph + Twitter tags pointing at `og-image.jpg`,
  and `Organization` JSON-LD containing **only confirmed fields**. Remove the
  unused `Inter` font link and the stray DataCloneError script **only if** you
  confirm nothing depends on it.
- Targets (Lighthouse mobile, production build served by FastAPI): Performance ≥ 90,
  Accessibility ≥ 95, SEO ≥ 95, CLS < 0.1. Report actual scores in the PR.
- Colour contrast AA, visible focus rings (the global `:focus-visible` rule
  exists), all controls keyboard reachable, form errors announced
  (`aria-live`), skip-to-content link, `lang="en"`.
- Test widths: 360, 390, 768, 1280, 1920. No horizontal scroll at any width.

## 7. Acceptance checklist

- [ ] Logged-out `/` shows the landing page; logged-in `/` still shows the dashboard.
- [ ] `/login` works and returns to the dashboard; logout lands on the login page.
- [ ] No invented facts anywhere; every unknown is a `TODO(owner)` in `content.js`
      and the corresponding section is hidden.
- [ ] Enquiry form works end-to-end, rate-limited, honeypot tested.
- [ ] All images generated, within budget, with `ASSETS.md`.
- [ ] Lighthouse numbers recorded; `npm run build` clean; `test_api.py` green.
