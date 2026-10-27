# Implementation Plan: Optimize Static Images (PNG → WebP)

## Current State
- **Location**: `static/images/` with `Black/` and `White/` subdirectories
- **Structure**: 3 categories (nutrition, workout, sinergy) × 2 themes = 26 PNG files
- **Total size**: ~19 MB (Black: ~11.4 MB, White: ~7.6 MB)
- **Usage**: Landing page phone carousel only (`SHOWCASE_IMAGES` in `app.js`)
- **Naming**: Simple sequential names (1.png, 2.png, etc.) per category

## Goals
1. Convert PNG → WebP at 80% quality
2. Resize images wider than 1200px
3. Update code references from `.png` to `.webp`
4. Keep original PNGs as backup (rename to `.png.backup` or move to `backup/` folder)
5. Target: Reduce total size by 60-80% (to ~3-5 MB)

## Affected Files & Changes

### 1. Python Optimization Script (`scripts/optimize_images.py`)
Create a script that:
- Recursively walks `static/images/`
- For each PNG:
  - Opens with Pillow
  - Checks dimensions; if width > 1200px, resize proportionally
  - Saves as WebP at 80% quality (`method=6` for best compression)
  - Backs up original: `mv file.png file.png.backup` (or moves to `backup/`)
- Outputs summary: before/after sizes, compression ratio

### 2. Update Code References (`static/js/app.js`)
- **`SHOWCASE_IMAGES` array** (lines 37-69): Change all `{ black: '1.png', white: '1.png' }` → `{ black: '1.webp', white: '1.webp' }`
- No other code changes needed (paths constructed dynamically via `landingImageSrc`)

### 3. Cleanup
- Verify landing page renders correctly in both themes
- Optionally remove `.png.backup` files after verification period

## Implementation Steps

1. **Check image dimensions** - Run quick script to list all images with dimensions
2. **Create optimization script** - Python + Pillow
3. **Run optimization** - Execute script, verify output
4. **Update `SHOWCASE_IMAGES`** - Change all `.png` → `.webp`
5. **Test landing page** - Verify both themes load images correctly
6. **Measure results** - Compare folder sizes before/after

## Validation Plan
1. `ls -la static/images/Black/ static/images/White/` - confirm `.webp` files exist
2. Open landing page in browser (light/dark themes) - verify all carousel images load
3. Check DevTools Network tab - confirm `.webp` requests, no 404s
4. Compare folder sizes: target < 5 MB total
5. Visual inspection - no quality degradation on phone mockups

## Risk Mitigation
- **Backup strategy**: Keep `.png.backup` files until validation complete
- **Rollback**: If issues, revert `SHOWCASE_IMAGES` and rename backups back to `.png`
- **Browser support**: WebP supported in all modern browsers (Chrome, Firefox, Safari 14+, Edge)

## Open Questions
- Should the script also handle any other image directories (e.g., `static/images/` root)?
- Do we need to update any Service Worker cache for these assets?