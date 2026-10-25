# Landing image provenance

Generated on 2026-10-25 using the built-in `image_gen.imagegen` tool, one separate request per scene. All images are illustrative, not photographs of Victoria Garments, its premises or its actual product range. Replace with owner-approved real photography when available. No runtime dependencies were added.

## Prompt set

Every prompt specified premium editorial product photography; soft natural window light; shallow depth of field; calm, uncluttered composition; a navy (#294F96), teal (#00AF92) and warm-neutral-white palette; photorealism without HDR. Every prompt prohibited people/faces, readable text, logos, brand names, labels, certification badges, flags, copyrighted designs and a specific factory building. Measuring tapes were requested with tick marks only, no readable numbers. These common constraints accompany each subject below when regenerating.

| Output | Use case and subject prompt | Source PNG identifier |
| --- | --- | --- |
| hero | `product-mockup`; wide 16:9 website hero, ideally 3840x2160. Folded cotton knit fabric stacks in navy, warm white and soft teal on a pale table, visible weave, a few plain thread spools. Window light from left, ample negative space on left for a later website headline, stacks mostly on right. | exec-1f7a51cc-dc00-438e-9d1d-8c0e1dcc79ee |
| mens-wear | `product-mockup`; portrait 4:5 men's wear card. Plain navy crew-neck t-shirt and folded grey polo flat-lay on pale linen, overhead composition. Plain neutral garments. | exec-f0ecdbb2-42bb-4378-863b-78aa3758a56e |
| womens-wear | `product-mockup`; portrait 4:5 women's wear card. Folded teal and white women's tops and lightweight knit cardigan flat-lay on pale linen, overhead, soft shadows. Plain neutral garments. | exec-84f3006a-1500-4866-b03b-95351871f827 |
| process-sampling | `photorealistic-natural`; landscape 4:3. Close-up of blank pattern paper, tailor's chalk and measuring tape on a pale cutting table. Illustrative garment-making process. | exec-06cbd4e5-6071-4340-abe1-085cb0c9fe76 |
| process-cutting | `photorealistic-natural`; landscape 4:3. Layered navy and teal fabric on a long pale cutting table with a plain straight-edge and metal tailor's shears, shallow focus. Illustrative garment-making process. | exec-29e85fb4-0ddd-45fb-9831-49b72e1513d0 |
| process-stitching | `photorealistic-natural`; landscape 4:3. Macro close-up of industrial sewing machine needle stitching a plain navy knit hem, focus on needle, presser foot and neat seam, no operator. Illustrative garment-making process. | exec-9f796e6e-0622-4c5f-9924-8926536c7259 |
| process-finishing | `photorealistic-natural`; landscape 4:3. Neatly checked plain folded garments on a pale table, small thread-snipping scissors and measuring tape beside them. Illustrative garment-making process. | exec-ba52a204-ab97-48c1-9fe7-986ce4b1c242 |
| process-packing | `photorealistic-natural`; landscape 4:3. Folded plain navy, white and teal garments neatly stacked into a plain unprinted cardboard carton with tissue paper. Illustrative garment-making process. | exec-afd6253f-b38e-409e-8d07-76957fad5e0e |
| texture-knit | `photorealistic-natural`; wide 8:3. Abstract extreme macro of navy jersey-knit loops, visible interlocking fine yarn detail in center, very soft focus edges, subtle teal reflected light. Textile only. | exec-f0b7ce43-1f92-48a3-aab6-16e98025f97e |

Original generated PNGs are retained in the generation tool's default directory, `.codex/generated_images/01a17335-730f-7232-b15f-335013f1a9fb/`, outside the repository. The application references only the final assets in this folder.

## Conversion and visual verification

Used existing Pillow 13.0.0 (development-only, already installed) to center-fit with Lanczos resampling and save optimized WebP, starting at quality 78 and reducing in steps of two until the byte budget passed. The generator returned the hero at 1672x941 despite the requested resolution; the 1920 and 3840 variants are resampled exports, not native 4K detail. The 2x JPEG needs quality 18 to meet the strict 250,000-byte cap; browsers supporting WebP should use the WebP variant. Subject composition and absence of readable labels/people were visually reviewed in the generated images and a contact sheet of the final exports.

| File | Pixels | Bytes | Quality |
| --- | --- | ---: | ---: |
| hero.webp | 1920x1080 | 186620 | 78 |
| hero.jpg | 1920x1080 | 236835 | adaptive, <=78 |
| hero@2x.webp | 3840x2160 | 245748 | 40 |
| hero@2x.jpg | 3840x2160 | 248833 | 18 |
| mens-wear.webp | 960x1200 | 115800 | 78 |
| womens-wear.webp | 960x1200 | 116754 | 60 |
| process-sampling.webp | 800x600 | 29646 | 78 |
| process-cutting.webp | 800x600 | 36470 | 78 |
| process-stitching.webp | 800x600 | 39844 | 78 |
| process-finishing.webp | 800x600 | 34822 | 78 |
| process-packing.webp | 800x600 | 33484 | 78 |
| texture-knit.webp | 1600x600 | 88776 | 78 |
| og-image.jpg | 1200x630 | 100842 | 76 |

All nine scene WebPs together, including the larger hero instead of its 1x variant, total 741344 bytes (under 900 KB). This excludes alternate formats and the social-only OG image, which are not all downloaded by the page. Below-fold assets should remain lazy-loaded.

`og-image.jpg` is the hero center-cropped to 1200x630 with the existing `../victoria-leaf.png` logo mark composited bottom-left at up to 90x110 pixels (40px left, 30px bottom), and no added text.

The favicon set is derived deterministically from the existing `../victoria-leaf.png`, centered at 78% of a white square: `../favicon-32.png` (32), `../apple-touch-icon.png` (180), `../logo192.png` (192), `../logo512.png` (512), and `../favicon.ico` (16/32/48/64). `../manifest.json` retains the matching icon filenames and uses the Victoria Garments name. Existing logo artwork remains unchanged. These files were visually checked against the supplied logo mark.

For needle/scissors/box/check/map UI symbols, use the project's existing Lucide icons at 1.5px stroke width; no additional generated icon assets are necessary.


## Phase 7: brand-blue landing artwork (2026-10-25)

The existing nine illustrative scenes were inspected against the official logo blue (`#054594`). Their navy, teal and neutral tones sit consistently inside the new solid-blue layout, so they were retained; no new synthetic factory or product claims were introduced. `scripts/landing_assets_v2.py` deterministically resizes those approved originals to 640, 960, 1280 and 1920-pixel WebP and JPEG variants using Pillow 13.0.0. The hero 1920 WebP is 174,780 bytes, below the 200 KB target. Every source in the `<picture>` sets includes the same subject and uses explicit dimensions and responsive `sizes`. The older original assets remain available, and the browser downloads only the selected responsive variant.

The social card was regenerated as an 1200×630 blue canvas with the official `victoria-logo-white.svg` centered, using CairoSVG 2.8.2 in the local development environment. The favicon, Apple touch icon and PWA icons were regenerated from the supplied `victoria-leaf.png` on `#054594`. CairoSVG and Pillow are development-only asset tools; neither is a runtime dependency. The `victoria-logo-white.svg` and `victoria-logo-color.svg` originals were not modified.

The Phase 1 image provenance and original prompt set above remain the source record. The new variants are derived exports, not independently generated images. Regeneration command: `backend\.venv\Scripts\python.exe scripts\landing_assets_v2.py` after installing development-only Pillow and CairoSVG. The social card contains only the owner's existing white vector logo and blue background.

## Phase 8: cinematic illustrative set (2026-10-25)

The built-in `image_gen.imagegen` tool produced **26 separate scenes, one request per scene**. The new pictures are editorial illustrations, never photographs of Victoria Garments, its premises, staff or actual products. Each prompt included: soft natural light, shallow depth of field, navy (`#054594`), teal (`#00AD8D`) and warm-white palette, photorealism without HDR, no faces or identifiable people, no readable text, logo, brand name, label, badge, flag, copyrighted design or specific factory building. The exact subject prompts and source PNGs are below. A contact sheet of 640px exports was inspected for consistency and disallowed content.

| Scene | Subject prompt | Source PNG (`.codex/generated_images/01a17334-8f13-7e61-9c5e-1a55472890f3/`) | Ratio |
| --- | --- | --- | --- |
| hero-knits | Folded cotton knit stacks in morning window light; dark-friendly left space | `exec-759f89c5-c108-4a70-b09c-042e99daafd7.png` | 16:9 |
| hero-line | Sewing line from a low angle, no people, machines receding softly | `exec-2a90369c-559e-48ff-a217-711f6fd87bec.png` | 16:9 |
| hero-cutting | Long cutting table and layered fabric receding into distance | `exec-e19b95ae-4290-45e2-bd50-feb837116819.png` | 16:9 |
| mens-crew | Plain navy crew-neck flat lay | `exec-24327cf0-d7f5-4e4f-993f-46050a28bb03.png` | 4:5 |
| mens-polo | Plain grey polo collar detail | `exec-ad296a33-344a-4d0e-993b-929363af5e9c.png` | 1:1 |
| mens-stack | Folded plain tees stack | `exec-032994c9-1b3e-4f35-ba65-afe9e4aff98c.png` | 4:5 |
| mens-rail | Rail of plain shirts, no labels | `exec-b4e2ef50-c702-4e68-99bb-f5f3b6b7f710.png` | 4:5 |
| mens-collar | Close crop of plain collar and stitching | `exec-80e3d521-d7e3-4206-9791-40727007c0ef.png` | 1:1 |
| womens-tops | Plain teal and white tops flat lay | `exec-fab8307d-7055-45b8-81f0-9e6b82f45f47.png` | 4:5 |
| womens-cardigan | Knit cardigan detail | `exec-d73dbe14-0043-4232-bcf7-0660c2395cec.png` | 1:1 |
| womens-rail | Rail of plain dresses, no labels | `exec-986b2b26-0d6e-477a-8541-824f2fa754f6.png` | 4:5 |
| womens-folded | Folded lightweight tops | `exec-cd5facfb-3207-435a-a464-f506d2a64d2c.png` | 4:5 |
| womens-seam | Close crop of plain teal seam | `exec-0ba6d91b-f674-42ab-befc-6d34a9cb43a7.png` | 1:1 |
| detail-jersey | Jersey-knit loops macro | `exec-37aa4b15-f445-4170-8346-27ecfb54afff.png` | 1:1 |
| detail-cuff | Plain ribbed knit cuff | `exec-cf4160a8-4876-4f40-b7c5-b74b929c3214.png` | 1:1 |
| detail-spools | Navy, teal and white thread spools | `exec-41d1e342-0e70-4cbb-b98b-0b57fc1f0792.png` | 3:2 |
| detail-fasteners | Buttons and zip on plain fabric | `exec-3bc1fddb-11a6-42f7-92d8-b942bd23ed7c.png` | 1:1 |
| detail-needle | Needle on a seam, no operator | `exec-afb8a64b-7ce4-4b08-9409-27d6ffdaac80.png` | 3:2 |
| detail-folds | Sculptural folded fabric edges | `exec-3698c49f-787e-4d8e-b180-273b480f9aaf.png` | 1:1 |
| process-sampling-v3 | Pattern paper, chalk and unnumbered measuring tape | `exec-41a00e25-326d-40dc-bc76-697423756779.png` | 4:3 |
| process-cutting-v3 | Layered fabric and shears on a cutting table | `exec-9aecd1da-c593-461a-9922-736c09461a73.png` | 4:3 |
| process-stitching-v3 | Machine needle stitching a plain knit hem | `exec-c8b08b48-0bdd-4118-b218-c936170f66cc.png` | 4:3 |
| process-finishing-v3 | Folded garments with checking tools | `exec-e5be3bfc-713a-44ab-856e-b6dcaa09e2c4.png` | 4:3 |
| process-packing-v3 | Folded garments in an unprinted carton | `exec-9bc19380-1d87-402d-8967-6fa39a273858.png` | 4:3 |
| panorama-rails | Garment rails receding into a cinematic panorama | `exec-9cc17f01-f022-4439-bfc0-3de315495501.png` | 21:9 |
| panorama-rolls | Navy, teal and white fabric rolls panorama | `exec-5c79773b-4158-4e14-99d7-3ef82f446a30.png` | 21:9 |

`scripts/landing_assets_v3.py` exports every scene at widths 640, 960, 1280 and 1920 in WebP (quality starting at 76, reduced only for the hero budget) and progressive JPEG. Hero frames also export at 2560. Crops use Lanczos center fit. The 1920 WebP hero files are kept below 220 KB. The Open Graph card is 1200×630: the official white SVG centred on deep ink navy (`#07162B`). Pillow 13.0.0 and CairoSVG 2.8.2 are local, development-only export tools. Framer Motion 12.43.0 is the only new runtime dependency, required by this phase's choreography.
