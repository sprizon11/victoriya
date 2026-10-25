# Landing page v2 QA — 2026-10-25

The public page was rebuilt with the official `#054594` blue and white SVG logo. The existing illustrative scenes were retained after visual inspection and exported at responsive sizes. A 1920-pixel hero WebP is 174,780 bytes. The social card uses the white logo on a solid blue background.

## Automated checks

- `backend/test_enquiries.py`: 48 passed, 0 failed.
- `backend/test_api.py`: 95 passed, 0 failed.
- `backend/test_public_seo.py`: passed (dynamic host/protocol, `/home` only, portal disallows, malformed host).
- `frontend/src/landing/LandingPage.test.js`: 4 passed, 0 failed.
- `npm run build`: Compiled successfully; no ESLint warnings. CRA emitted its existing Node `fs.F_OK` deprecation warning.
- Source-level checks: all image tags carry `alt`, empty business-fact sections are absent, and hex colours occur only in the CSS token block.

## Contrast pairs (WCAG relative luminance)

| Text / foreground | Background | Contrast |
| --- | --- | ---: |
| White | Brand blue `#054594` | 9.19:1 |
| White | Deep blue `#032E63` | 13.33:1 |
| Brand blue | White | 9.19:1 |
| Ink `#0E1B33` | White | 17.17:1 |
| Muted `#4B5A73` | White | 6.98:1 |
| Muted | Blue tint `#EEF4FC` | 6.31:1 |
| Light green `#6FE6CB` | Brand blue | 6.06:1 |
| Light blue `#D6E4F7` | Brand blue | 7.13:1 |
| Brand blue | Blue tint | 8.31:1 |

## Browser and Lighthouse gate

The requested 390, 768, 1024 and 1440-pixel browser checks, keyboard-only walkthrough, reduced-motion check and Lighthouse mobile run could not be performed. The browser origin gate denied `http://localhost:3000` twice, including after the owner asked us to restart the UI server. The second response cited a saved permission setting blocking the origin and explicitly forbade alternate browser or command routes. Thus Lighthouse Performance, Accessibility, Best Practices, SEO, LCP and CLS scores are **unavailable**, and no viewport result is claimed. The UI server was listening on port 3000 after restart. A future browser-enabled session must finish these checks before claiming the phase's visual and Lighthouse acceptance targets.

## Owner facts still needed

`content.js` keeps empty placeholders for postal address, opening hours, WhatsApp number, founding year, capacity, machine count, workforce, awards, certifications, clients, markets, real photos, testimonials and the confirmed domain. The suggested buyer journey also needs owner confirmation. No such figures or sections appear by default.
