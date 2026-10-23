# Implementation Plan: Fix Syntax Error (`Unexpected token 'else'`) in `app.js`

## Goal
Fix the `Uncaught SyntaxError: Unexpected token 'else'` in `static/js/app.js` around line 221 caused by an orphaned `else` block following a misplaced `try/catch` wrapper around an asynchronous promise chain (`validateToken().then(...).catch(...)`).

## Affected Boundaries & Changes
- **`static/js/app.js` (`init` method)**:
  - Remove the invalid `try { ... } catch (e) { ... } else { ... }` wrapping around the async `validateToken().then(...).catch(...)` call.
  - Structure the token presence check cleanly:
    ```javascript
    if (this.state.tokens.access) {
        console.log('[App] Token found, validating...');
        // Defer validation to background to allow cache-first render
        this.validateToken().then(() => this.initSyncEngine()).catch((e) => {
            console.error('[App] Token validation failed:', e);
            if (e?.isNetworkError || !navigator.onLine || !this.state.isOnline) {
                console.warn('[App] Network error during init token validation; retaining offline session.');
                this.showScreen('main');
                const { page, workout } = this.loadState();
                if (workout) {
                    this.state.activeWorkout = workout;
                    this.showPage('workouts');
                } else {
                    this.showPage(page || 'nutrition');
                }
            } else {
                this.showScreen('landing');
                this.renderLanding();
            }
        });
        
        // Proactively show cached main screen state
        ...
    } else {
        this.showScreen('landing');
        this.renderLanding();
    }
    ```

## Validation Plan
1. Check JavaScript syntax using Node or linter/compiler to ensure no syntax errors remain in `app.js`.
2. Verify app cold start and initialization flow runs without uncaught syntax errors.
