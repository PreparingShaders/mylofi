# Plan: Landing Page Refactoring (Lofi + Dark Minimal)

## Goal
Completely overhaul the landing screen (`renderLanding()` in `static/js/app.js`) to match a modern Lofi + Dark Minimal aesthetic (`#0F0F12` / `#12131C` background, soft purple/indigo glow, glassmorphism cards with `border-white/10`), implement Header, Hero Section, 3-card Features Grid, and Footer **strictly without emojis**, using SVG icons and clean typography.

## Requirements & Constraints
1. **Concept & Aesthetic**:
   - Deep dark theme (`#0F0F12` / `#12131C`), ambient background glow, glassmorphism (`backdrop-blur`, `border-white/10`).
   - Header logo with active service indicator (pulsing purple dot).
   - **ZERO EMOJIS** across all texts and components.
2. **Structure**:
   - **Header**: Logo left (MyLofi.live + dot), actions right ("Войти" outline, "Начать" filled).
   - **Hero Section**:
     - Badge: "Трекинг в твоём собственном ритме"
     - H1: "Твой умный нутрициолог и журнал тренировок"
     - Subtitle: "Контролируй КБЖУ, фиксируй рабочий вес и следи за прогрессом без суеты и лишнего шума — в стильном тёмном интерфейсе"
     - CTA buttons: "Создать дневник" (primary) and "Уже есть аккаунт" (secondary).
   - **Features Grid (3 cards, SVG icons, no emojis)**:
     1. Учёт питания — быстрый подсчёт калорий и макронутриентов, анализ блюд через ИИ и наглядный дневник рациона.
     2. Дневник зала — удобный ввод подходов, повторов и весов, отслеживание прогрессирующей нагрузки.
     3. Lofi-философия — тёмная тема по умолчанию, лаконичный дизайн без визуального шума для полного фокуса на результате.
   - **Footer**: `© mylofi.live — Осознанный фитнес и нутрициология`.
3. **Responsiveness**:
   - Mobile vertical layout, desktop `grid-cols-3` feature cards.

## Affected Files
- `static/js/app.js`: Refactor `renderLanding()` to build the complete landing HTML structure.

## Implementation Steps
1. **Update `renderLanding()` in `static/js/app.js`**:
   - Construct container with dark lofi styling and ambient glow background.
   - Build Header, Hero, 3 Features cards (with SVG icons), and Footer.
   - Bind click actions (`show-auth`, `show-register`) to buttons.

## Validation & Verification Plan
1. Check landing page rendering in browser/UI.
2. Verify all 4 sections (Header, Hero, Features, Footer) are present and styled correctly.
3. Verify absence of any emojis.
4. Verify responsive scaling on mobile and desktop.
