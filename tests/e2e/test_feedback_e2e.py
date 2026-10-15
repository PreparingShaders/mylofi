"""E2E tests for the feedback / support system via Playwright.

Run with: pytest tests/e2e/test_feedback_e2e.py -v
"""
import asyncio
import uuid

import pytest
import pytest_asyncio
from playwright.async_api import BrowserContext, Page, async_playwright

BASE_URL = "http://localhost:8000"


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
    await page.wait_for_function(
        "() => !document.getElementById('app-splash')", timeout=15000
    )


async def open_feedback_modal_guest(page: Page):
    """Open the feedback modal from the landing screen (guest)."""
    await page.goto(BASE_URL)
    await page.wait_for_selector("#app-splash", state="detached", timeout=15000)
    await page.wait_for_timeout(500)
    await page.wait_for_selector(
        "#screen-landing:not(.hidden)", state="visible", timeout=10000
    )
    await page.evaluate("""() => {
        const btn = document.querySelector('#screen-landing button[data-action="open-feedback-modal"]');
        if (btn) btn.click();
    }""")
    await page.wait_for_selector("#feedback-modal-panel", state="visible", timeout=10000)


@pytest.mark.asyncio
async def test_guest_feedback_modal_opens_from_landing(page: Page):
    await open_feedback_modal_guest(page)
    # Email field visible for guest
    email_input = await page.query_selector("#feedback-email")
    assert email_input is not None
    # Submit button present
    submit_btn = await page.query_selector('[data-action="submit-feedback"]')
    assert submit_btn is not None


@pytest.mark.asyncio
async def test_guest_feedback_requires_message(page: Page):
    await open_feedback_modal_guest(page)
    await page.fill("#feedback-email", "guest@example.com")
    await page.click('[data-action="submit-feedback"]')
    # Should show error toast, not close modal
    await page.wait_for_timeout(500)
    panel = await page.query_selector("#feedback-modal-panel")
    assert panel is not None


@pytest.mark.asyncio
async def test_guest_feedback_submits_successfully(page: Page):
    await open_feedback_modal_guest(page)
    await page.fill("#feedback-email", "guest@example.com")
    await page.fill("#feedback-message", "Test feedback from E2E")
    await page.click('[data-action="submit-feedback"]')
    # Modal should close and a success toast should appear
    await page.wait_for_timeout(1500)
    # Check toast text
    toast_text = await page.evaluate("""() => {
        const el = document.querySelector('#toast-container .toast, .toast-success, [role="alert"]');
        return el ? el.textContent : '';
    }""")
    assert "успешно" in toast_text.lower() or "отправ" in toast_text.lower() or "сообщение" in toast_text.lower(), f"Toast: {toast_text}"
    # Modal should be gone
    panel = await page.query_selector("#feedback-modal-panel")
    assert panel is None, "Modal should close after successful submit"


@pytest.mark.asyncio
async def test_guest_feedback_invalid_email_rejected(page: Page):
    await open_feedback_modal_guest(page)
    await page.fill("#feedback-email", "not-an-email")
    await page.fill("#feedback-message", "Test")
    await page.click('[data-action="submit-feedback"]')
    await page.wait_for_timeout(500)
    # Modal should still be open
    panel = await page.query_selector("#feedback-modal-panel")
    assert panel is not None, "Modal should stay open on invalid email"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])