"""Export the approved Phase 8 illustrative scenes for responsive delivery."""

from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "frontend/public/landing"
SOURCE = Path("C:/Users/spriz/.codex/generated_images/01a17334-8f13-7e61-9c5e-1a55472890f3")
SCENES = {
    "hero-knits": ("exec-759f89c5-c108-4a70-b09c-042e99daafd7.png", (16, 9)),
    "hero-line": ("exec-2a90369c-559e-48ff-a217-711f6fd87bec.png", (16, 9)),
    "hero-cutting": ("exec-e19b95ae-4290-45e2-bd50-feb837116819.png", (16, 9)),
    "mens-crew": ("exec-24327cf0-d7f5-4e4f-993f-46050a28bb03.png", (4, 5)),
    "mens-polo": ("exec-ad296a33-344a-4d0e-993b-929363af5e9c.png", (1, 1)),
    "mens-stack": ("exec-032994c9-1b3e-4f35-ba65-afe9e4aff98c.png", (4, 5)),
    "mens-rail": ("exec-b4e2ef50-c702-4e68-99bb-f5f3b6b7f710.png", (4, 5)),
    "mens-collar": ("exec-80e3d521-d7e3-4206-9791-40727007c0ef.png", (1, 1)),
    "womens-tops": ("exec-fab8307d-7055-45b8-81f0-9e6b82f45f47.png", (4, 5)),
    "womens-cardigan": ("exec-d73dbe14-0043-4232-bcf7-0660c2395cec.png", (1, 1)),
    "womens-rail": ("exec-986b2b26-0d6e-477a-8541-824f2fa754f6.png", (4, 5)),
    "womens-folded": ("exec-cd5facfb-3207-435a-a464-f506d2a64d2c.png", (4, 5)),
    "womens-seam": ("exec-0ba6d91b-f674-42ab-befc-6d34a9cb43a7.png", (1, 1)),
    "detail-jersey": ("exec-37aa4b15-f445-4170-8346-27ecfb54afff.png", (1, 1)),
    "detail-cuff": ("exec-cf4160a8-4876-4f40-b7c5-b74b929c3214.png", (1, 1)),
    "detail-spools": ("exec-41d1e342-0e70-4cbb-b98b-0b57fc1f0792.png", (3, 2)),
    "detail-fasteners": ("exec-3bc1fddb-11a6-42f7-92d8-b942bd23ed7c.png", (1, 1)),
    "detail-needle": ("exec-afb8a64b-7ce4-4b08-9409-27d6ffdaac80.png", (3, 2)),
    "detail-folds": ("exec-3698c49f-787e-4d8e-b180-273b480f9aaf.png", (1, 1)),
    "process-sampling-v3": ("exec-41a00e25-326d-40dc-bc76-697423756779.png", (4, 3)),
    "process-cutting-v3": ("exec-9aecd1da-c593-461a-9922-736c09461a73.png", (4, 3)),
    "process-stitching-v3": ("exec-c8b08b48-0bdd-4118-b218-c936170f66cc.png", (4, 3)),
    "process-finishing-v3": ("exec-e5be3bfc-713a-44ab-856e-b6dcaa09e2c4.png", (4, 3)),
    "process-packing-v3": ("exec-9bc19380-1d87-402d-8967-6fa39a273858.png", (4, 3)),
    "panorama-rails": ("exec-9cc17f01-f022-4439-bfc0-3de315495501.png", (21, 9)),
    "panorama-rolls": ("exec-5c79773b-4158-4e14-99d7-3ef82f446a30.png", (21, 9)),
}


def fitted(im, size):
    target_ratio = size[0] / size[1]
    ratio = im.width / im.height
    if ratio > target_ratio:
        width = int(im.height * target_ratio)
        left = (im.width - width) // 2
        im = im.crop((left, 0, left + width, im.height))
    else:
        height = int(im.width / target_ratio)
        top = (im.height - height) // 2
        im = im.crop((0, top, im.width, top + height))
    return im.resize(size, Image.Resampling.LANCZOS)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for name, (file, ratio) in SCENES.items():
        with Image.open(SOURCE / file) as original:
            original = original.convert("RGB")
            for width in (640, 960, 1280, 1920, 2560) if name.startswith("hero-") else (640, 960, 1280, 1920):
                size = (width, round(width * ratio[1] / ratio[0]))
                image = fitted(original, size)
                quality = 76
                target = DEST / f"{name}-{width}.webp"
                while quality >= 38:
                    image.save(target, "WEBP", quality=quality, method=6)
                    if not name.startswith("hero-") or width != 1920 or target.stat().st_size < 220_000:
                        break
                    quality -= 4
                image.save(DEST / f"{name}-{width}.jpg", "JPEG", quality=76, optimize=True, progressive=True)
    card = Image.new("RGB", (1200, 630), "#07162B")
    logo_bytes = cairosvg.svg2png(url=str(ROOT / "frontend/public/victoria-logo-white.svg"), output_width=610)
    with Image.open(BytesIO(logo_bytes)) as logo:
        logo = logo.convert("RGBA")
        card.paste(logo, ((1200 - logo.width) // 2, (630 - logo.height) // 2), logo)
    card.save(DEST / "og-image.jpg", "JPEG", quality=86, optimize=True)


if __name__ == "__main__":
    main()
