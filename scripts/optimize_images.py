#!/usr/bin/env python3
"""
Optimize showcase carousel images: PNG → WebP with proportional resize.

- Recursively walks static/images/
- For each PNG: resize if width > 1200px (proportional), save as WebP (quality=80, method=6)
- Backs up original in-place: file.png → file.png.backup
- Prints before/after summary with compression ratio.
"""

import os
import sys
from pathlib import Path
from PIL import Image

# Ensure UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

IMAGES_DIR = Path(__file__).resolve().parent.parent / "static" / "images"
MAX_WIDTH = 1200
WEBP_QUALITY = 80
WEBP_METHOD = 6  # best compression


def optimize_png(png_path: Path) -> dict:
    """Convert a single PNG to WebP, resizing if needed. Backup saved in-place.

    Returns a summary dict with before/after sizes and dimensions.
    """
    webp_path = png_path.with_suffix(".webp")
    backup_path = png_path.with_suffix(".png.backup")

    if webp_path.exists():
        print(f"  SKIP (already converted): {webp_path}")
        return {"file": str(png_path), "skipped": True}

    original_size = png_path.stat().st_size

    with Image.open(png_path) as img:
        img = img.convert("RGBA")  # preserve transparency
        orig_w, orig_h = img.size

        if orig_w > MAX_WIDTH:
            ratio = MAX_WIDTH / orig_w
            new_h = round(orig_h * ratio)
            img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
            resized = True
            new_w, new_h = MAX_WIDTH, new_h
        else:
            resized = False
            new_w, new_h = orig_w, orig_h

        img.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)

    webp_size = webp_path.stat().st_size

    # Back up original in-place
    os.rename(png_path, backup_path)

    summary = {
        "file": str(png_path),
        "orig_size_kb": round(original_size / 1024, 1),
        "webp_size_kb": round(webp_size / 1024, 1),
        "orig_dims": f"{orig_w}x{orig_h}",
        "new_dims": f"{new_w}x{new_h}",
        "resized": resized,
        "ratio": f"{webp_size / original_size:.1%}",
    }
    return summary


def main() -> int:
    if not IMAGES_DIR.exists():
        print(f"ERROR: {IMAGES_DIR} does not exist")
        return 1

    png_files = sorted(IMAGES_DIR.rglob("*.png"))
    # Exclude .backup files
    png_files = [f for f in png_files if not f.name.endswith(".backup")]

    if not png_files:
        print("No PNG files found to convert.")
        return 0

    print(f"Found {len(png_files)} PNG files in {IMAGES_DIR}\n")

    results = []
    total_before = 0
    total_after = 0

    for png_path in png_files:
        rel = png_path.relative_to(IMAGES_DIR)
        print(f"Converting: {rel}")
        summary = optimize_png(png_path)
        results.append(summary)
        if not summary.get("skipped"):
            total_before += png_path.with_suffix(".png.backup").stat().st_size
            total_after += png_path.with_suffix(".webp").stat().st_size
        print(
            f"  {summary['orig_size_kb']} KB → {summary['webp_size_kb']} KB "
            f"({summary['ratio']} saved)"
            + (f" [resized {summary['orig_dims']} → {summary['new_dims']}]" if summary.get("resized") else "")
        )

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Files processed:   {len([r for r in results if not r.get('skipped')])}")
    print(f"Files skipped:     {len([r for r in results if r.get('skipped')])}")
    print(f"Total before:      {total_before / 1024 / 1024:.1f} MB")
    print(f"Total after:       {total_after / 1024 / 1024:.1f} MB")
    if total_before > 0:
        print(f"Space saved:       {(1 - total_after / total_before):.1%}")
    print(f"Backups saved as:  *.png.backup (in-place)")
    print(f"WebP files:        *.webp")

    return 0


if __name__ == "__main__":
    sys.exit(main())
