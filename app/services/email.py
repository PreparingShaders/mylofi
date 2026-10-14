import logging
import os

import httpx

from app.core.config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)

BREVO_API_BASE = "https://api.brevo.com/v3"

_PLACEHOLDER_KEYS = {
    "your-brevo-api-key",
    "your-api-key",
    "",
    None,
}


def _brevo_key() -> str | None:
    key = os.getenv("BREVO_API_KEY") or settings.BREVO_API_KEY or None
    if key in _PLACEHOLDER_KEYS:
        return None
    return key


def _sender() -> dict:
    return {
        "email": settings.BREVO_SENDER_EMAIL,
        "name": settings.BREVO_SENDER_NAME,
    }


async def send_verification_email(
    email: str,
    code: str,
    purpose: str = "register",
) -> bool:
    """Send a verification code email via the Brevo API.

    Best-effort: returns True when the email was dispatched, False when the API
    key is missing or the request failed. A failure to send must never block the
    verification flow — the code is stored in the database regardless, and a
    logged error is enough for an operator to notice.
    """
    api_key = _brevo_key()
    if not api_key:
        logger.warning(
            "[Email] BREVO_API_KEY is not set or is a placeholder; "
            "skipping email delivery for %s. "
            "Set a valid BREVO_API_KEY in the environment to enable email sending.",
            email,
        )
        return False

    if purpose == "reset_password":
        subject = "MyLofi — восстановление пароля"
        body = f"""
        <html>
        <body style="font-family: Inter, sans-serif; color: #18181b; line-height: 1.6;">
            <h2>Восстановление пароля</h2>
            <p>Вы запросили сброс пароля. Ваш одноразовый код подтверждения:</p>
            <h1 style="font-size: 32px; font-weight: 700; color: #22c55e; letter-spacing: 4px;">{code}</h1>
            <p>Код действителен 10 минут.</p>
            <p>Если вы не запрашивали сброс пароля, просто игнорируйте это письмо.</p>
        </body>
        </html>
        """
        text = f"Ваш код подтверждения для сброса пароля: {code}\n\nКод действителен 10 минут."
    else:
        subject = "MyLofi — подтверждение email"
        body = f"""
        <html>
        <body style="font-family: Inter, sans-serif; color: #18181b; line-height: 1.6;">
            <h2>Подтверждение регистрации</h2>
            <p>Добро пожаловать в MyLofi! Ваш код подтверждения:</p>
            <h1 style="font-size: 32px; font-weight: 700; color: #22c55e; letter-spacing: 4px;">{code}</h1>
            <p>Введите этот код для завершения регистрации. Код действителен 10 минут.</p>
        </body>
        </html>
        """
        text = f"Ваш код подтверждения для регистрации: {code}\n\nКод действителен 10 минут."

    payload = {
        "sender": _sender(),
        "to": [{"email": email}],
        "subject": subject,
        "htmlContent": body,
        "textContent": text,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{BREVO_API_BASE}/smtp/email",
                headers={
                    "accept": "application/json",
                    "content-type": "application/json",
                    "api-key": api_key,
                },
                json=payload,
            )
        response.raise_for_status()
        logger.info("[Email] Verification email sent to %s", email)
        return True
    except httpx.HTTPStatusError as e:
        logger.error("[Email] Brevo API error for %s: %s", email, e.response.text[:300])
        return False
    except Exception as e:
        logger.error("[Email] Failed to send email to %s: %s", email, e)
        return False
