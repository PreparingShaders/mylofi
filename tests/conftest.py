"""Pytest configuration for E2E tests."""

import asyncio
import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.db.session import async_session_maker
from app.models import User

pytest_plugins = ["pytest_asyncio"]


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def cleanup_test_users():
    """Session-level teardown to clean up test users after all tests complete."""
    yield
    # Teardown: delete test users matching patterns
    async with async_session_maker() as db:
        await db.execute(delete(User).where(User.email.like('test_%@example.com')))
        await db.execute(delete(User).where(User.email.like('test_%@%.com')))
        await db.commit()