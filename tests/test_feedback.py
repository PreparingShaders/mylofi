"""Integration tests for the feedback / support system.

Run with: pytest tests/test_feedback.py -v
"""
import io
import os
import uuid

import pytest
from fastapi import UploadFile
from sqlalchemy import select

from app.api.v1.routes import create_feedback, get_optional_current_user
from app.models import Feedback, FeedbackStatus, User
from app.schemas import FeedbackCategory, FeedbackResponse


pytest_plugins = ["pytest_asyncio"]


def _upload_file(filename="screenshot.png", content_type="image/png", data=b"\x89PNG fake"):
    from starlette.datastructures import Headers
    return UploadFile(
        file=io.BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


@pytest.mark.asyncio
async def test_guest_feedback_requires_email(db_session):
    with pytest.raises(Exception):
        await create_feedback(
            category="bug",
            message="Test bug",
            email=None,
            images=[],
            db=db_session,
            current_user=None,
        )


@pytest.mark.asyncio
async def test_guest_feedback_invalid_email(db_session):
    with pytest.raises(Exception):
        await create_feedback(
            category="bug",
            message="Test bug",
            email="not-an-email",
            images=[],
            db=db_session,
            current_user=None,
        )


@pytest.mark.asyncio
async def test_guest_feedback_success(db_session):
    response = await create_feedback(
        category="question",
        message="How do I log a meal?",
        email="guest@example.com",
        images=[],
        db=db_session,
        current_user=None,
    )
    assert isinstance(response, FeedbackResponse)
    assert response.id is not None
    assert response.email == "guest@example.com"
    assert response.category == FeedbackCategory.QUESTION
    assert response.status == FeedbackStatus.NEW
    assert response.images is None

    result = await db_session.execute(select(Feedback).where(Feedback.id == response.id))
    fb = result.scalar_one()
    assert fb.user_id is None
    assert fb.email == "guest@example.com"


@pytest.mark.asyncio
async def test_authenticated_feedback_uses_user_email(db_session, normal_user):
    response = await create_feedback(
        category="pro_request",
        message="I want PRO",
        email=None,
        images=[],
        db=db_session,
        current_user=normal_user,
    )
    assert response.email == normal_user.email
    result = await db_session.execute(select(Feedback).where(Feedback.id == response.id))
    fb = result.scalar_one()
    assert fb.user_id == normal_user.id


@pytest.mark.asyncio
async def test_feedback_image_limit(db_session):
    files = [_upload_file() for _ in range(4)]
    with pytest.raises(Exception):
        await create_feedback(
            category="bug",
            message="Too many images",
            email="guest@example.com",
            images=files,
            db=db_session,
            current_user=None,
        )


@pytest.mark.asyncio
async def test_feedback_invalid_image_type(db_session):
    files = [_upload_file(filename="x.txt", content_type="text/plain")]
    with pytest.raises(Exception):
        await create_feedback(
            category="bug",
            message="Bad image",
            email="guest@example.com",
            images=files,
            db=db_session,
            current_user=None,
        )


@pytest.mark.asyncio
async def test_feedback_image_saved(db_session):
    files = [_upload_file()]
    response = await create_feedback(
        category="bug",
        message="Screenshot attached",
        email="guest@example.com",
        images=files,
        db=db_session,
        current_user=None,
    )
    assert response.images is not None
    assert len(response.images) == 1
    assert os.path.exists(response.images[0])


@pytest.mark.asyncio
async def test_optional_current_user_no_token(db_session):
    user = await get_optional_current_user(db=db_session, authorization=None)
    assert user is None


@pytest.mark.asyncio
async def test_optional_current_user_bad_token(db_session):
    user = await get_optional_current_user(db=db_session, authorization="Bearer garbage")
    assert user is None


@pytest.mark.asyncio
async def test_optional_current_user_valid_token(db_session, normal_user):
    from app.services.auth import create_access_token
    access = create_access_token({"sub": str(normal_user.id), "email": normal_user.email})
    user = await get_optional_current_user(db=db_session, authorization=f"Bearer {access}")
    assert user is not None
    assert user.id == normal_user.id