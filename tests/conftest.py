"""Pytest configuration for E2E tests."""

import asyncio
import uuid

import pytest
import pytest_asyncio
from app.models import User, VerificationCode
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from app.core.config import get_settings

pytest_plugins = ["pytest_asyncio"]


def _engine():
    settings = get_settings()
    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=False,
    )


def _maker(engine):
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


@pytest_asyncio.fixture
async def db_session():
    """A session that is rolled back at the end of each test.

    Each test runs in its own transaction so the database stays clean without
    needing to delete rows manually. The transaction is opened explicitly and
    rolled back in teardown: ``session.begin()``'s context manager would
    commit on exit, which is the opposite of what an isolation fixture wants.

    A fresh engine is created per test rather than sharing the app's global
    one. asyncpg ties connections to the event loop that opened them, and
    pytest-asyncio gives every function-scoped test its own loop; a pooled
    connection from a previous test cannot be pinged on the new loop and
    raises ``AttributeError: 'NoneType' object has no attribute 'send'``.
    """
    engine = _engine()
    maker = _maker(engine)
    async with maker() as session:
        await session.begin()
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.rollback()
    await engine.dispose()


def _unique(base: str) -> str:
    """Make a fixed test email unique per run so re-runs don't collide."""
    return f"{base}_{uuid.uuid4().hex[:8]}@example.com"


@pytest_asyncio.fixture
async def admin_user(db_session):
    user = User(
        email=_unique("admin_test"),
        hashed_password="x",
        is_admin=True,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    yield user


@pytest_asyncio.fixture
async def normal_user(db_session):
    user = User(
        email=_unique("user_test"),
        hashed_password="x",
        is_admin=False,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    yield user


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_users():
    """Session-level teardown to clean up test users after all tests complete.

    Implemented as a sync (non-async) session-scoped fixture so it does not
    collide with the function-scoped event loop that pytest-asyncio 0.21
    assigns to every async test; an async session-scoped fixture would raise
    ``ScopeMismatch`` because pytest-asyncio's default ``event_loop`` fixture is
    function-scoped. The DB teardown runs on its own throwaway event loop.
    """
    yield
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_cleanup())
    finally:
        loop.close()


async def _cleanup():
    engine = _engine()
    maker = _maker(engine)
    async with maker() as db:
        await db.execute(
            delete(VerificationCode).where(
                VerificationCode.email.like("test_%@example.com")
            )
        )
        await db.execute(
            delete(VerificationCode).where(VerificationCode.email.like("test_%@%.com"))
        )
        await db.execute(delete(User).where(User.email.like("test_%@example.com")))
        await db.execute(delete(User).where(User.email.like("test_%@%.com")))
        await db.execute(
            delete(User).where(User.email.like("admin_test_%@example.com"))
        )
        await db.execute(
            delete(User).where(User.email.like("user_test_%@example.com"))
        )
        await db.commit()
    await engine.dispose()
