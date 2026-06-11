"""
generate_icons.py -- Creates 16x16, 48x48, 128x128 PNG icons for the Linco extension.
Requires Pillow: pip install Pillow

Usage: python generate_icons.py
Output: icons/icon16.png, icons/icon48.png, icons/icon128.png
"""

import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow not found. Installing...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image, ImageDraw


def draw_icon(size):
    """Draw the Linco icon at the given pixel size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle with dark fill
    bg_color = (13, 15, 20, 255)  # #0d0f14
    draw.ellipse([0, 0, size - 1, size - 1], fill=bg_color)

    # Gradient simulation: draw concentric ellipses from purple to blue
    steps = 12
    for i in range(steps):
        t = i / (steps - 1)
        r = int(124 + (37 - 124) * t)    # 124 -> 37  (#7c -> #25)
        g = int(58  + (99 - 58)  * t)    # 58  -> 99  (#3a -> #63)
        b = int(237 + (235 - 237) * t)   # 237 -> 235 (#ed -> #eb)
        alpha = int(220 - i * 5)

        margin = size * 0.08 + i * (size * 0.02)
        draw.ellipse(
            [margin, margin, size - margin - 1, size - margin - 1],
            fill=(r, g, b, alpha)
        )

    # White center dot
    center = size / 2
    dot_r = size * 0.18
    draw.ellipse(
        [center - dot_r, center - dot_r, center + dot_r, center + dot_r],
        fill=(255, 255, 255, 255)
    )

    return img


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, "icons")
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [16, 48, 128]
    for size in sizes:
        icon = draw_icon(size)
        out_path = os.path.join(icons_dir, f"icon{size}.png")
        icon.save(out_path, "PNG")
        print(f"[OK] Created {out_path}")

    print("\nAll icons generated successfully!")
    print("Load at chrome://extensions/ -> Load unpacked -> select the 'extension' folder.")


if __name__ == "__main__":
    main()
