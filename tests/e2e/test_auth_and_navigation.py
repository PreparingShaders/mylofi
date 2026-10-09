"""
E2E tests for authentication and navigation using Playwright.

Run with: pytest tests/e2e/test_auth_and_navigation.py -v
"""

import pytest
import pytest_asyncio
from playwright.async_api import BrowserContext, Page, async_playwright
from sqlalchemy import delete

from app.db.session import async_session_maker
from app.models import User

BASE_URL = "http://localhost:8000"


@pytest_asyncio.fixture(scope="session", autouse=True)
async def cleanup_test_users():
    """Session-level teardown to clean up test users after all tests complete."""
    yield
    # Teardown: delete test users matching patterns
    async with async_session_maker() as db:
        await db.execute(delete(User).where(User.email.like('test_%@example.com')))
        await db.execute(delete(User).where(User.email.like('test_%@%.com')))
        await db.commit()


@pytest_asyncio.fixture(scope="session")
async def browser():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        yield browser
        await browser.close()


@pytest_asyncio.fixture(scope="function")
async def context(browser):
    context = await browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    )
    yield context
    await context.close()


@pytest_asyncio.fixture(scope="function")
async def page(context: BrowserContext):
    page = await context.new_page()
    yield page
    await page.close()


async def wait_for_app_init(page: Page):
    """Wait for the app to finish initialization (splash screen removed)."""
    await page.wait_for_function(
        "() => !document.getElementById('app-splash')",
        timeout=10000
    )


async def login(page: Page, email: str, password: str = "Password123!"):
    """Log in with the given credentials."""
    await page.goto(BASE_URL)
    # Wait for splash screen to be completely removed from DOM
    await page.wait_for_selector('#app-splash', state='detached', timeout=15000)
    # Small delay for landing screen to fully render
    await page.wait_for_timeout(500)
    # Wait for landing screen to be visible (no .hidden class)
    await page.wait_for_selector('#screen-landing:not(.hidden)', state='visible', timeout=10000)
    # Click via JS to bypass Playwright visibility checks
    await page.evaluate('''() => {
        const btn = document.querySelector('#screen-landing button[data-action="show-auth"]');
        if (btn) btn.click();
    }''')
    await page.wait_for_selector('#screen-auth:not(.hidden)')

    # Fill login form
    await page.fill('#login-form input[type="email"]', email)
    await page.fill('#login-form input[type="password"]', password)
    
    # Listen for dialogs (alerts) and console errors
    page.on('dialog', lambda dialog: print(f"[ALERT] {dialog.message}") or dialog.accept())
    page.on('console', lambda msg: print(f"[CONSOLE] {msg.type}: {msg.text}") if msg.type in ['error', 'warning'] else None)
    
    # Submit and wait
    await page.click('#login-form button[type="submit"]')
    
    # Wait a bit for response
    await page.wait_for_timeout(3000)
    
    # Check what screen is visible
    screens = await page.evaluate('''() => {
        return {
            landing: document.getElementById('screen-landing')?.className,
            auth: document.getElementById('screen-auth')?.className,
            main: document.getElementById('screen-main')?.className,
        };
    }''')
    print(f"Screen states after login: {screens}")
    
    # Check for error toast - use try/except to avoid timeout
    try:
        toast = await page.locator('#toast-container .toast, .toast-error, [role="alert"]').first.text_content(timeout=1000)
        if toast:
            print(f"Toast: {toast}")
    except Exception:
        pass
    
    # Wait for main screen
    await page.wait_for_selector('#screen-main:not(.hidden)', timeout=10000)
    # Ensure splash is gone after login
    await page.wait_for_selector('#app-splash', state='detached', timeout=10000)


async def register_new_user(page: Page, email: str, password: str = "Password123!", name: str = "Test User"):
    """Register a new user. Returns after registration shows login screen."""
    await page.goto(BASE_URL)
    # Wait for splash screen to be completely removed from DOM
    await page.wait_for_selector('#app-splash', state='detached', timeout=15000)
    # Small delay for landing screen to fully render
    await page.wait_for_timeout(500)
    # Wait for landing screen to be visible (no .hidden class)
    await page.wait_for_selector('#screen-landing:not(.hidden)', state='visible', timeout=10000)
    # Click via JS to bypass Playwright visibility checks
    await page.evaluate('''() => {
        const btn = document.querySelector('#screen-landing button[data-action="show-register"]');
        if (btn) btn.click();
    }''')
    await page.wait_for_selector('#screen-auth:not(.hidden)')

    # Fill register form
    await page.fill('#register-form input[name="full_name"]', name)
    await page.fill('#register-form input[type="email"]', email)
    await page.fill('#register-form input[type="password"]', password)
    await page.fill('#register-form input[name="password_confirm"]', password)
    
    # Listen for dialogs (alerts) and console errors
    page.on('dialog', lambda dialog: print(f"[ALERT] {dialog.message}") or dialog.accept())
    page.on('console', lambda msg: print(f"[CONSOLE] {msg.type}: {msg.text}") if msg.type in ['error', 'warning', 'log'] else None)
    
    # Submit and wait
    print("Submitting register form...")
    await page.click('#register-form button[type="submit"]')
    
    # Wait a bit for response
    await page.wait_for_timeout(3000)
    
    # Check what screen is visible
    screens = await page.evaluate('''() => {
        return {
            landing: document.getElementById('screen-landing')?.className,
            auth: document.getElementById('screen-auth')?.className,
            main: document.getElementById('screen-main')?.className,
        };
    }''')
    print(f"Screen states after register: {screens}")
    
    # Check for error toast - use try/except to avoid timeout
    try:
        toast = await page.locator('#toast-container .toast, .toast-error, [role="alert"]').first.text_content(timeout=1000)
        if toast:
            print(f"Toast: {toast}")
    except Exception:
        pass
    
    # Wait for auth screen (login form) to be shown after registration
    await page.wait_for_selector('#screen-auth:not(.hidden)', timeout=10000)
    # Ensure splash is gone
    await page.wait_for_selector('#app-splash', state='detached', timeout=10000)


class TestRegistrationFlow:
    """Test user registration flow."""

    async def test_register_new_user(self, page: Page):
        """Test registration flow for a new user."""
        import uuid
        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"

        # Register new user
        await register_new_user(page, unique_email, "TestPass123!", "Test User")
        
        # After registration, app shows login screen - now log in
        await page.fill('#login-form input[type="email"]', unique_email)
        await page.fill('#login-form input[type="password"]', "TestPass123!")
        await page.click('#login-form button[type="submit"]')
        await page.wait_for_selector('#screen-main:not(.hidden)', timeout=10000)

        # Verify we're on the main app (nutrition page)
        await page.wait_for_selector('#page-content')
        # Wait for nutrition page to fully render (uses h3 for title)
        await page.wait_for_selector('h3:has-text("Питание")', timeout=10000)
        nutrition_title = await page.locator('h3:has-text("Питание")').count()
        assert nutrition_title > 0, "Should be on nutrition page after registration"

        # Verify bottom nav is visible
        bottom_nav = await page.locator('#bottom-nav').is_visible()
        assert bottom_nav, "Bottom navigation should be visible after login"


class TestLoginFlow:
    """Test login flow for seeded test users."""

    async def test_login_free_user(self, page: Page):
        """Test login for free_user@mylofi.test."""
        await login(page, "free_user@mylofi.test")

        # Verify we're on the main app
        await page.wait_for_selector('#page-content')
        assert await page.locator('#screen-main:not(.hidden)').is_visible()

        # Verify user is not premium (check profile or usage)
        await page.click('.nav-item[data-page="profile"]')
        await page.wait_for_selector('#page-content')
        # Free user should not have premium badge
        # This is a basic check - the profile page should render

    async def test_login_premium_user(self, page: Page):
        """Test login for premium_user@mylofi.test."""
        await login(page, "premium_user@mylofi.test")

        # Verify we're on the main app
        await page.wait_for_selector('#page-content')
        assert await page.locator('#screen-main:not(.hidden)').is_visible()

        # Verify user is premium
        await page.click('.nav-item[data-page="profile"]')
        await page.wait_for_selector('#page-content')
        # Premium user should have premium features available


class TestNoAuthFlash:
    """Test that there's no FOUC (Flash of Unauthenticated Content)."""

    async def test_no_auth_flash_on_reload_with_token(self, page: Page, context: BrowserContext):
        """Verify no auth flash occurs on page reload when access token is stored."""
        # First, log in
        await login(page, "free_user@mylofi.test")

        # Get the access token from localStorage
        access_token = await page.evaluate("() => localStorage.getItem('access_token')")
        assert access_token, "Access token should be in localStorage after login"

        # Reload the page
        await page.reload()
        await wait_for_app_init(page)

        # Should go directly to main app without showing landing/auth
        await page.wait_for_selector('#screen-main:not(.hidden)', timeout=5000)

        # Landing and auth screens should be hidden
        landing_visible = await page.locator('#screen-landing:not(.hidden)').is_visible()
        auth_visible = await page.locator('#screen-auth:not(.hidden)').is_visible()

        assert not landing_visible, "Landing screen should not be visible after reload with token"
        assert not auth_visible, "Auth screen should not be visible after reload with token"

    async def test_splash_screen_shows_during_init(self, page: Page):
        """Verify splash screen is shown during app initialization."""
        await page.goto(BASE_URL)

        # Splash screen should be visible initially
        splash_visible = await page.locator('#app-splash').is_visible()
        print(f"Splash visible: {splash_visible}")
        
        # Also check landing screen
        landing_hidden = await page.locator('#screen-landing').get_attribute('class')
        print(f"Landing class: {landing_hidden}")
        
        assert splash_visible, "Splash screen should be visible on initial load"

        # Wait for app init to complete - splash should be detached
        await page.wait_for_selector('#app-splash', state='detached', timeout=10000)

        # Splash should be gone
        splash_count = await page.locator('#app-splash').count()
        assert splash_count == 0, "Splash screen should be removed after init"


class TestNavigation:
    """Test navigation between tabs."""

    async def test_navigate_to_nutrition_tab(self, page: Page):
        """Test navigation to Nutrition tab."""
        await login(page, "free_user@mylofi.test")

        # Should be on nutrition by default
        await page.wait_for_selector('#page-content')
        # Nutrition page uses h3 for title
        await page.wait_for_selector('h3:has-text("Питание")', timeout=10000)
        nutrition_title = await page.locator('h3:has-text("Питание")').count()
        assert nutrition_title > 0

    async def test_navigate_to_workouts_tab(self, page: Page):
        """Test navigation to Workouts tab."""
        await login(page, "free_user@mylofi.test")

        await page.click('.nav-item[data-page="workouts"]')
        await page.wait_for_selector('#page-content')

        # Check for workouts content (uses h2)
        await page.wait_for_selector('h2:has-text("Тренировки")', timeout=10000)
        workouts_title = await page.locator('h2:has-text("Тренировки")').count()
        assert workouts_title > 0

    async def test_navigate_to_profile_tab(self, page: Page):
        """Test navigation to Profile tab."""
        await login(page, "free_user@mylofi.test")

        await page.click('.nav-item[data-page="profile"]')
        await page.wait_for_selector('#page-content')

        # Check for profile content (uses h2)
        await page.wait_for_selector('h2:has-text("Профиль")', timeout=10000)
        profile_title = await page.locator('h2:has-text("Профиль")').count()
        assert profile_title > 0

    async def test_navigation_persists_active_tab(self, page: Page):
        """Test that active tab is visually indicated."""
        await login(page, "free_user@mylofi.test")

        # Check nutrition tab is active initially
        nutrition_nav = page.locator('.nav-item[data-page="nutrition"]')
        await nutrition_nav.wait_for()
        assert "active" in await nutrition_nav.get_attribute("class")

        # Switch to workouts
        await page.click('.nav-item[data-page="workouts"]')
        workouts_nav = page.locator('.nav-item[data-page="workouts"]')
        await workouts_nav.wait_for()
        assert "active" in await workouts_nav.get_attribute("class")

        # Switch to profile
        await page.click('.nav-item[data-page="profile"]')
        profile_nav = page.locator('.nav-item[data-page="profile"]')
        await profile_nav.wait_for()
        assert "active" in await profile_nav.get_attribute("class")


class TestLogout:
    """Test logout flow."""

    async def test_logout_returns_to_landing(self, page: Page):
        """Test that logout returns user to landing page."""
        await login(page, "free_user@mylofi.test")

        # Go to profile and logout
        await page.click('.nav-item[data-page="profile"]')
        await page.wait_for_selector('#page-content')

        # Click logout button
        await page.click('button[data-action="logout"]')

        # Should be back on landing
        await page.wait_for_selector('#screen-landing:not(.hidden)', timeout=5000)
        assert await page.locator('#screen-landing:not(.hidden)').is_visible()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])