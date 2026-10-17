# Plan: Update SHOWCASE_IMAGES Paths to Simple Filenames

## Goal
Update the `SHOWCASE_IMAGES` configuration in `static/js/app.js` to use simplified filenames (`1.png`, `2.png`, etc.) matching the reorganized image structure in `static/images/Black/` and `static/images/White/`.

## Affected Files
- `static/js/app.js`: Module-level `SHOWCASE_IMAGES` constant defining chapters, folders, alternative texts, and slide filename mappings for `black` and `white` themes.
- Image assets on disk:
  - `static/images/Black/nutrition/` & `static/images/White/nutrition/`: `1.png` through `5.png` (5 slides)
  - `static/images/Black/sinergy/` & `static/images/White/sinergy/`: `1.png`, `2.png` (2 slides)
  - `static/images/Black/workout/` & `static/images/White/workout/`: `1.png`/`1.PNG` through `6.png` (6 slides)

## Proposed Changes

### 1. Update `SHOWCASE_IMAGES` in `static/js/app.js`
Replace the long timestamp-based filenames with simple numbered filenames:

```javascript
const SHOWCASE_IMAGES = [
    {
        folder: 'nutrition',
        alt: 'Питание',
        slides: [
            { black: '1.png', white: '1.png' },
            { black: '2.png', white: '2.png' },
            { black: '3.png', white: '3.png' },
            { black: '4.png', white: '4.png' },
            { black: '5.png', white: '5.png' },
        ],
    },
    {
        folder: 'workout',
        alt: 'Тренировки',
        slides: [
            { black: '1.PNG', white: '1.png' }, // Recommended: normalize 1.PNG to 1.png on disk for cross-platform consistency
            { black: '2.png', white: '2.png' },
            { black: '3.png', white: '3.png' },
            { black: '4.png', white: '4.png' },
            { black: '5.png', white: '5.png' },
            { black: '6.png', white: '6.png' },
        ],
    },
    {
        folder: 'sinergy',
        alt: 'ИИ-Синергия',
        slides: [
            { black: '1.png', white: '1.png' },
            { black: '2.png', white: '2.png' },
        ],
    },
];
```

### 2. File Casing Consistency Check
- Ensure `static/images/Black/workout/1.PNG` is either referenced as `'1.PNG'` or renamed/normalized to `'1.png'` on disk to avoid casing mismatches on case-sensitive production environments (Linux/Docker).

## Validation & Verification Plan
1. **Slide Count Alignment**: Verify that `SHOWCASE_IMAGES[i].slides.length` matches filesystem counts (`nutrition: 5`, `workout: 6`, `sinergy: 2`).
2. **Carousel & Pagination Check**: Ensure `totalSlides`, pagination dots, and arrow navigation correctly render 5, 6, and 2 dots/slides respectively without empty placeholders.
3. **Theme Switcher Test**: Toggle between Dark and Light themes on the landing page and verify `landingImageSrc()` constructs correct paths (`/static/images/Black/...` vs `/static/images/White/...`) loading existing images successfully.
