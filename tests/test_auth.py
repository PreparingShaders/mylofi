import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.services.auth import create_user_tokens, rotate_refresh_token, validate_refresh_token


@pytest.mark.asyncio
async def test_refresh_rotation_grace_period_replays_same_pair(normal_user, db_session):
    """A duplicate rotation of an already-rotated refresh token, within the
    grace window, must replay the SAME new token pair instead of 401."""
    user = normal_user
    _, refresh_token = await create_user_tokens(db_session, user)

    # First rotation revokes the token and issues a new pair.
    at1, rt1 = await rotate_refresh_token(db_session, refresh_token)

    # The old token is now revoked: a plain validation fails.
    assert await validate_refresh_token(db_session, refresh_token) is None

    # Duplicate rotation of the revoked token replays the same pair (idempotent).
    at2, rt2 = await rotate_refresh_token(db_session, refresh_token)
    assert (at2, rt2) == (at1, rt1)

    # The rotated refresh token must still be valid: the session is intact.
    user_again = await validate_refresh_token(db_session, rt1)
    assert user_again is not None
    assert user_again.id == user.id


@pytest.mark.asyncio
async def test_concurrent_refresh_rotation_is_idempotent(normal_user, db_session):
    """Concurrent rotations of the same refresh token must not diverge into
    distinct token pairs: every successful rotation returns the same pair."""
    user = normal_user
    _, refresh_token = await create_user_tokens(db_session, user)

    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=False)
    maker = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )

    async def rotate() -> tuple[str, str]:
        async with maker() as session:
            return await rotate_refresh_token(session, refresh_token)

    results = await asyncio.gather(*[rotate() for _ in range(8)], return_exceptions=True)
    await engine.dispose()

    successes = [r for r in results if not isinstance(r, Exception)]
    assert len(successes) >= 1, "at least one concurrent rotation must succeed"

    # All successful rotations must agree on a single token pair: no rotation
    # divergence, no destroyed session.
    pairs = {(access, refresh) for access, refresh in successes}
    assert len(pairs) == 1, f"rotations diverged into {len(pairs)} distinct pairs"

    new_access, new_refresh = successes[0]
    assert new_refresh != refresh_token

    # The winning refresh token must still validate (session intact).
    user_again = await validate_refresh_token(db_session, new_refresh)
    assert user_again is not None
    assert user_again.id == user.id
