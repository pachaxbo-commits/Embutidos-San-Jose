from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\fabri\Downloads\d3f24837-2c8a-4c5e-a6d9-d8ca26c58a8b.png")
RES = ROOT / "android" / "app" / "src" / "main" / "res"


def trimmed_logo():
    image = Image.open(SOURCE).convert("RGBA")
    box = image.getbbox()
    return image.crop(box) if box else image


def contain(logo, size, ratio, background=(0, 0, 0, 0)):
    canvas = Image.new("RGBA", (size, size), background)
    max_width = int(size * ratio)
    max_height = int(size * ratio)
    scale = min(max_width / logo.width, max_height / logo.height)
    resized = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main():
    logo = trimmed_logo()
    web = ROOT / "public" / "brand"
    web.mkdir(parents=True, exist_ok=True)
    logo.save(web / "san-jose-logo.png", optimize=True)
    contain(logo, 192, 0.88, (255, 255, 255, 255)).save(web / "san-jose-app-icon.png", optimize=True)
    contain(logo, 64, 0.90).save(ROOT / "public" / "favicon.png", optimize=True)

    for folder in RES.glob("mipmap-*"):
        if not folder.is_dir() or folder.name == "mipmap-anydpi-v26":
            continue
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            target = folder / name
            if not target.exists():
                continue
            with Image.open(target) as current:
                size = current.width
            if name == "ic_launcher_foreground.png":
                output = contain(logo, size, 0.66)
            else:
                output = contain(logo, size, 0.86, (255, 255, 255, 255))
            output.save(target, optimize=True)

    for target in RES.glob("drawable*/splash.png"):
        with Image.open(target) as current:
            width, height = current.size
        canvas = Image.new("RGBA", (width, height), (250, 247, 242, 255))
        max_width, max_height = int(width * 0.72), int(height * 0.32)
        scale = min(max_width / logo.width, max_height / logo.height)
        resized = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.Resampling.LANCZOS)
        canvas.alpha_composite(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
        canvas.save(target, optimize=True)


if __name__ == "__main__":
    main()
