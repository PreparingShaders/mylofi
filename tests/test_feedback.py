"""Integration tests for the feedback / support system.

Run with: pytest tests/test_feedback.py -v
"""
import io
import os
import uuid

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.v1.routes import create_feedback, get_current_admin_user, get_optional_current_user
from app.db.session import get_db
from app.main import app
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


# ===== Admin feedback reply endpoint tests =====


@pytest.fixture
def admin_client(db_session, admin_user):
    """TestClient with get_db bound to the test session and an admin user."""

    async def override_get_db():
        yield db_session

    async def override_admin():
        return admin_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_admin_user] = override_admin
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def normal_client(db_session, normal_user):
    """TestClient bound to the test session with a non-admin user."""

    async def override_get_db():
        yield db_session

    async def override_admin():
        return normal_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_admin_user] = override_admin
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _insert_feedback(db_session, email, user_id=None, status="new"):
    fb = Feedback(
        user_id=user_id,
        email=email,
        category=FeedbackCategory.QUESTION,
        message="Помогите войти в аккаунт",
        images=None,
        status=status,
    )
    db_session.add(fb)
    return fb


@pytest.mark.asyncio
async def test_admin_feedback_reply_resolves_ticket(db_session, admin_client):
    fb = _insert_feedback(db_session, email="guest@example.com")
    await db_session.flush()
    await db_session.refresh(fb)

    response = admin_client.post(
        f"/api/v1/admin/feedback/{fb.id}/reply",
        json={"reply_text": "Проверьте подключение к интернету и попробуйте снова."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "resolved"

    result = await db_session.execute(select(Feedback).where(Feedback.id == fb.id))
    assert result.scalar_one().status == FeedbackStatus.RESOLVED


@pytest.mark.asyncio
async def test_admin_feedback_reply_uses_user_email(db_session, admin_client, normal_user):
    fb = _insert_feedback(db_session, email="", user_id=normal_user.id)
    await db_session.flush()
    await db_session.refresh(fb)

    response = admin_client.post(
        f"/api/v1/admin/feedback/{fb.id}/reply",
        json={"reply_text": "Ответ пользователю."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "resolved"


@pytest.mark.asyncio
async def test_admin_feedback_reply_requires_admin(db_session, normal_client):
    fb = _insert_feedback(db_session, email="user@example.com")
    await db_session.flush()
    await db_session.refresh(fb)

    response = normal_client.post(
        f"/api/v1/admin/feedback/{fb.id}/reply",
        json={"reply_text": "Недостаточно прав."},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_feedback_reply_not_found(db_session, admin_client):
    response = admin_client.post(
        "/api/v1/admin/feedback/999999/reply",
        json={"reply_text": "Текст."},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_feedback_reply_no_email(db_session, admin_client):
    fb = _insert_feedback(db_session, email="", user_id=None)
    await db_session.flush()
    await db_session.refresh(fb)

    response = admin_client.post(
        f"/api/v1/admin/feedback/{fb.id}/reply",
        json={"reply_text": "Текст."},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_admin_feedback_reply_empty_text_rejected(db_session, admin_client):
    fb = _insert_feedback(db_session, email="guest@example.com")
    await db_session.flush()
    await db_session.refresh(fb)

    response = admin_client.post(
        f"/api/v1/admin/feedback/{fb.id}/reply",
        json={"reply_text": ""},
    )
    assert response.status_code == 422