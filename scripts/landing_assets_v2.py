"""Prepare responsive landing assets from the approved illustrative originals and official logo."""
from io import BytesIO
from pathlib import Path
from PIL import Image
import cairosvg

root = Path(__file__).resolve().parents[1] / 'frontend' / 'public'
assets = root / 'landing'
sources = {
    'hero': assets / 'hero.webp',
    'mens-wear': assets / 'mens-wear.webp',
    'womens-wear': assets / 'womens-wear.webp',
    'texture-knit': assets / 'texture-knit.webp',
    **{f'process-{part}': assets / f'process-{part}.webp' for part in ['sampling','cutting','stitching','finishing','packing']},
}
for name, path in sources.items():
    image = Image.open(path).convert('RGB')
    for width in (640, 960, 1280, 1920):
        height = round(image.height * width / image.width)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        quality = 78
        target = assets / f'{name}-{width}.webp'
        if name == 'hero' and width == 1920:
            while True:
                resized.save(target, 'WEBP', quality=quality, method=6)
                if target.stat().st_size < 200_000 or quality <= 40:
                    break
                quality -= 2
        else:
            resized.save(target, 'WEBP', quality=quality, method=6)
        resized.save(assets / f'{name}-{width}.jpg', 'JPEG', quality=78, optimize=True)
        print(name, width, height, target.stat().st_size, quality)

logo = Image.open(BytesIO(cairosvg.svg2png(url=str(root / 'victoria-logo-white.svg'), output_width=850))).convert('RGBA')
card = Image.new('RGB', (1200, 630), '#054594')
card.paste(logo, ((1200-logo.width)//2, (630-logo.height)//2), logo)
card.save(assets / 'og-image.jpg', 'JPEG', quality=88, optimize=True)

leaf = Image.open(root / 'victoria-leaf.png').convert('RGBA')
for size, filename in [(32,'favicon-32.png'),(180,'apple-touch-icon.png'),(192,'logo192.png'),(512,'logo512.png')]:
    canvas = Image.new('RGBA', (size,size), '#054594')
    mark = leaf.resize((round(size*.74),round(size*.74)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size-mark.width)//2,(size-mark.height)//2))
    canvas.convert('RGB').save(root / filename, 'PNG', optimize=True)
canvas = Image.open(root / 'logo512.png')
canvas.save(root / 'favicon.ico', sizes=[(16,16),(32,32),(48,48),(64,64)])
