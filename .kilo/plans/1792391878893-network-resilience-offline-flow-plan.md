# Implementation Plan: Active Workout Interface Redesign

## Overview
Comprehensive redesign of the active workout interface (`static/js/workouts.js` + `static/css/styles.css`) addressing 4 major areas:

1. **Liquid Fill Exercise Track Circles** - Liquid fill animation + exercise numbers
2. **Symmetric Track Layout** - Cancel (×) at start, Add (+) at end, exercises in middle
3. **Rest Timer Positioning Fix** - Adaptive container, no overflow
4. **AI Analysis Badge** - Recommended weight/reps in collapsed header

---

## 1. Liquid Fill Exercise Track Circles

### Current State
- Circles use conic gradient (`conic-gradient(from -90deg, ${fillColor} ${percent * 3.6}deg, transparent 0)`)
- No exercise numbers inside circles
- Sharp "pie slice" appearance

### New Design: Liquid Fill Effect

#### Visual Design
```
┌─────────────────────────────────────────────────────────────┐
│  Exercise Track (horizontal scroll)                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                  │
│  │  ×  │ │  1  │ │  2  │ │  3  │ │  +  │  ← Symmetric    │
│  │     │ │ ███░│ │ ████│ │ ░░░░│ │     │                  │
│  │  1  │ │  3/3│ │ 2/4 │ │ 0/3 │ │  4  │                  │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                  │
│  Cancel    Ex 1      Ex 2      Ex 3      Add New           │
└─────────────────────────────────────────────────────────────┘
```

#### Liquid Fill Implementation (CSS-only)

**Technique**: Use `::before` pseudo-element with `clip-path: inset(calc(100% - var(--fill)) 0 0 0)` for smooth liquid rise animation.

```css
.exercise-track-circle {
    position: relative;
    overflow: hidden;
    background: transparent;
    border: 2px solid var(--border-color);
}

.exercise-track-circle::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--fill-color);
    clip-path: inset(calc(100% - var(--fill-percent)) 0 0 0);
    transition: clip-path 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 0;
}

.exercise-track-circle .circle-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
}
```

**States**:
| State | `--fill-color` | `--border-color` | Content |
|-------|----------------|------------------|---------|
| **cancel** | `transparent` | `#ef4444` (red-500) | × icon |
| **empty** | `transparent` | `#3f3f46` | Exercise number |
| **partial** | `#1a2e05` (lime-950) | `#4d7c0c` | Exercise number + fill |
| **active** | `#1a2e05` | `#84cc16` | Exercise number + pulse |
| **complete** | `#4d7c0c` | `#84cc16` | ✓ checkmark |
| **add** | `transparent` | `#3f3f46` dashed | + icon |

#### Exercise Numbers
- Always show exercise index (1, 2, 3...) inside circle
- For partial/active: number + fill level visible
- For complete: replace with checkmark
- For cancel/add: icons (×, +)

#### CSS Animation
```css
@keyframes liquid-rise {
    from { clip-path: inset(100% 0 0 0); }
    to { clip-path: inset(calc(100% - var(--target-fill)) 0 0 0); }
}

.exercise-track-circle::before {
    animation: liquid-rise 0.5s ease-out forwards;
}
```

---

## 2. Symmetric Track Layout

### Structure
```
[Cancel ×] [Ex 1] [Ex 2] [Ex 3] ... [Add +]
   ↑                               ↑
index 0                         last index
```

### Implementation

#### `buildExerciseTrackCircles()` Modification
```javascript
buildExerciseTrackCircles(session) {
    const exercises = this.currentSession?.exercises || session.exercises || [];
    if (exercises.length === 0) return this.renderEmptyTrack();
    
    const activeIdx = this.findActiveExerciseIndex(session);
    
    // 1. Cancel button (always first)
    const circles = [this.renderCancelCircle()];
    
    // 2. Exercise circles
    exercises.forEach((ex, i) => {
        circles.push(this.renderExerciseCircle(ex, i, activeIdx));
    });
    
    // 3. Add exercise button (always last)
    circles.push(this.renderAddCircle());
    
    return circles.join('');
}
```

#### Circle Renderers
```javascript
renderCancelCircle() {
    return `
        <button type="button"
                data-action="cancel-workout-from-track"
                role="tab"
                aria-label="Отменить тренировку"
                class="exercise-track-circle cancel">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>
    `;
}

renderExerciseCircle(ex, i, activeIdx) {
    const state = this.getExerciseTrackState(ex);
    const sets = ex.sets || [];
    const completed = sets.filter(s => s.is_completed).length;
    const total = sets.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const isActive = i === activeIdx;
    
    const fillPercent = state === 'complete' ? 100 : percent;
    
    return `
        <button type="button"
                data-exercise-index="${i}"
                data-exercise-id="${ex.id}"
                role="tab"
                aria-label="Упражнение ${i + 1}: ${ex.name}"
                class="exercise-track-circle ${state} ${isActive ? 'active' : ''}"
                style="--fill-percent: ${fillPercent}%; --fill-color: ${this.getFillColor(state)}; --border-color: ${this.getBorderColor(state, isActive)};"
                data-track-state="${state}"
                data-track-percent="${percent}">
            <div class="circle-content">
                ${state === 'complete' 
                    ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>'
                    : `<span class="exercise-number">${i + 1}</span>`}
            </div>
        </button>
    `;
}

renderAddCircle() {
    return `
        <button type="button"
                data-action="add-exercise-from-track"
                role="tab"
                aria-label="Добавить упражнение"
                class="exercise-track-circle add">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
        </button>
    `;
}
```

---

## 3. Rest Timer Positioning Fix

### Current Problems
1. Timer bar overflows right edge on mobile
2. Presets chips don't scroll properly
3. Timer can overlap bottom sets (4th, 5th)
4. Fixed width causes horizontal overflow

### Fix Strategy

#### HTML Structure Changes (`renderWorkoutScreen`)
```html
<div id="rest-timer-bar" class="hidden fixed bottom-16 left-0 right-0 z-50 rest-timer-bar"
     role="timer" aria-live="polite" aria-label="Таймер отдыха">
    <div class="rest-timer-bar__inner glass rounded-2xl w-full max-w-[92vw] mx-auto">
        <div class="flex flex-col gap-2 p-3">
            <!-- Mode toggle (compact segmented) -->
            <div class="flex gap-1" data-rest-timer-mode-toggle>
                <button data-action="rest-timer-mode" data-mode="timer" class="mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors">Таймер</button>
                <button data-action="rest-timer-mode" data-mode="stopwatch" class="mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors">Секундомер</button>
            </div>
            
            <!-- Timer mode content -->
            <div data-timer-mode class="space-y-2">
                <!-- Presets - horizontally scrollable -->
                <div class="rest-timer-presets flex gap-1.5 overflow-x-auto pb-1" data-timer-presets>
                    ${REST_TIMER_PRESETS.map(sec => `
                        <button type="button" data-action="rest-timer-preset" data-preset="${sec}"
                                class="preset-btn flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold glass text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-white/10 transition-colors snap-start">
                            ${sec >= 60 ? `${sec / 60}м` : `${sec}с`}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Custom input -->
                <div class="flex items-center gap-1">
                    <input type="number" min="1" max="600" data-action="rest-timer-custom"
                           class="w-16 h-7 text-center text-xs font-mono rounded-lg glass-input focus:outline-none focus:border-primary-500"
                           placeholder="90">
                    <span class="text-[10px] text-surface-500 dark:text-surface-400">сек</span>
                </div>
            </div>
            
            <!-- Stopwatch mode content -->
            <div data-stopwatch-mode class="hidden space-y-2">
                <div class="text-center text-xs text-surface-500 dark:text-surface-400">
                    Нажмите «Готов» для фиксации времени
                </div>
            </div>
            
            <!-- Timer display + dismiss -->
            <div class="flex items-center justify-between gap-2 pt-1">
                <div class="flex items-center gap-2">
                    <span class="animate-pulse-lime text-lime-600 dark:text-lime-400" aria-hidden="true">⏱</span>
                    <span id="rest-timer-remaining" class="font-mono text-xl font-bold text-lime-600 dark:text-lime-400 tabular-nums min-w-[3.5rem] text-center">00:00</span>
                    <span id="rest-timer-state" class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase">Отдых</span>
                </div>
                <button id="rest-timer-dismiss" data-action="dismiss-rest-timer" type="button"
                        class="flex-shrink-0 glass rounded-xl px-3 py-1.5 text-xs font-semibold text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-white/10 transition-colors"
                        aria-label="Готов">
                    Готов
                </button>
            </div>
        </div>
    </div>
</div>
```

#### CSS Fixes
```css
.rest-timer-bar {
    bottom: calc(4rem + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    pointer-events: none;
}

.rest-timer-bar__inner {
    pointer-events: auto;
    width: 100%;
    max-width: 92vw;
    margin: 0 auto;
    box-sizing: border-box;
}

.rest-timer-presets {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    scrollbar-width: none;
}

.rest-timer-presets::-webkit-scrollbar {
    display: none;
}

.rest-timer-presets button {
    flex-shrink: 0;
    scroll-snap-align: start;
}
```

#### Positioning Fix
- Use `left: 0; right: 0; max-width: 92vw; margin: 0 auto;` for centered adaptive width
- Ensure `z-index: 50` is below modals (z-[120]) and toasts (z-[130])
- Add `bottom: calc(4rem + env(safe-area-inset-bottom))` for safe area

---

## 4. AI Analysis Badge in Collapsed Header

### Current State
- AI analysis block has toggle button + collapsible content
- When collapsed, user sees only "ИИ-анализ" text
- Must expand to see recommendations

### New Design
Show compact badge in toggle button with recommended weight/reps:

```
┌─────────────────────────────────────────────────────────────┐
│  ▼ ИИ-анализ                                    [ 80кг × 8 ] │  ← Collapsed
│  ▶ ИИ-анализ                                    [ 80кг × 8 ] │  ← Collapsed (alt)
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### Modified Toggle Button (line ~2865-2877)
```html
<button type="button"
        data-action="toggle-ai-analysis"
        class="ai-analysis-toggle w-full flex items-center justify-between gap-2 text-xs font-semibold text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-surface-100 py-1.5 px-2 rounded-xl glass transition-colors"
        aria-expanded="true">
    <span>ИИ-анализ</span>
    <span class="ai-analysis-badge hidden" data-ai-badge></span>
    <svg class="chevron w-4 h-4 transition-transform duration-150" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M7 10l5 5 5-5z"/>
    </svg>
</button>
```

#### Badge Content
```html
<span class="ai-analysis-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300">
    ${weight_kg}кг × ${reps}
</span>
```

#### Update Logic (`updateAiPlanBadges`)
```javascript
updateAiPlanBadges(container) {
    if (!container || !this.aiPlan) return;
    container.querySelectorAll('.workout-card[data-exercise-id]').forEach(card => {
        const nameEl = card.querySelector('h3');
        const name = nameEl?.textContent || '';
        const rec = this.findAiPlanFor(name);
        
        // Update badge in toggle button
        const badgeEl = card.querySelector('[data-ai-badge]');
        if (rec && (rec.weight_kg || rec.reps)) {
            const badgeText = `${rec.weight_kg || '—'}кг × ${rec.reps || '—'}`;
            if (badgeEl) {
                badgeEl.textContent = badgeText;
                badgeEl.classList.remove('hidden');
            }
        } else if (badgeEl) {
            badgeEl.classList.add('hidden');
        }
        
        // Existing badge injection logic for expanded state...
        const contentEl = card.querySelector('.ai-analysis-content');
        if (contentEl && rec) {
            contentEl.innerHTML = Components.aiWorkoutPlanBadge(rec);
        }
    });
}
```

#### CSS for Badge
```css
.ai-analysis-badge {
    white-space: nowrap;
    flex-shrink: 0;
}

.ai-analysis-toggle[aria-expanded="false"] .ai-analysis-badge {
    /* Badge visible in both states */
}
```

---

## Affected Files

| File | Changes |
|------|---------|
| `static/js/workouts.js` | `buildExerciseTrackCircles`, `buildExerciseTrackCircles` helpers, `renderWorkoutScreen` (timer HTML), `updateAiPlanBadges`, `updateExerciseTrack` handlers |
| `static/css/styles.css` | `.exercise-track-circle` (liquid fill), `.rest-timer-bar__inner`, `.rest-timer-presets`, `.ai-analysis-badge`, circle state colors |

---

## Validation Plan

### 1. Liquid Fill Circles
- [ ] Circles show exercise numbers (1, 2, 3...)
- [ ] Liquid fill rises smoothly from bottom (0.4s animation)
- [ ] Empty: transparent, zinc border, number visible
- [ ] Partial: lime fill rises to %, number visible
- [ ] Active: lime fill + pulse animation
- [ ] Complete: filled lime-800, white checkmark
- [ ] Cancel: red border, × icon
- [ ] Add: dashed border, + icon
- [ ] Both themes work

### 2. Symmetric Track
- [ ] First circle: × (cancel), red border
- [ ] Middle circles: exercises with numbers
- [ ] Last circle: + (add), dashed border
- [ ] Click cancel → confirms cancellation
- [ ] Click add → opens exercise modal
- [ ] Click exercise → scrolls to card
- [ ] Track updates when exercises added/removed

### 3. Rest Timer
- [ ] Timer bar max-width 92vw, centered
- [ ] No horizontal overflow on 320px screen
- [ ] Presets horizontally scrollable
- [ ] No overlap with bottom sets
- [ ] "Готов" saves rest time to previous set
- [ ] Inline rest time appears after save
- [ ] Timer mode / stopwatch mode both work

### 4. AI Analysis Badge
- [ ] Badge shows "80кг × 8" in toggle button when collapsed
- [ ] Badge updates when AI plan arrives
- [ ] Badge hidden when no recommendation
- [ ] Expanded state still shows full analysis

---

## Implementation Order

1. **Rest Timer Fix** (critical - data loss + layout bug)
2. **Liquid Fill Circles** (core visual redesign)
3. **Symmetric Track** (structural change)
4. **AI Analysis Badge** (UX improvement)
5. **Timer "Готов" Fix** (data persistence)

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Liquid fill CSS not supported on older iOS | Low | `clip-path: inset()` well supported since iOS 13 |
| Liquid fill performance on many circles | Low | Max 10 circles; CSS-only animation |
| Cancel button accidental tap | Medium | Confirmation modal; distinct red styling |
| Timer bar still overlaps on very small screens | Low | Test at 320px; `max-w-[92vw]` |
| Liquid fill animation jank on low-end | Low | `will-change: clip-path`; compositor-only |

---

## Notes

- **Priority 1**: Rest timer positioning + "Готов" fix (data loss + layout)
- **Priority 2**: Liquid fill circles (signature feature)
- **Priority 3**: Symmetric track (structural)
- **Priority 4**: AI badge (polish)
- All colors use existing lime/zinc design tokens
- Test on iOS Safari (Dynamic Island, safe areas) and Android Chrome