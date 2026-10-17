import asyncio
import argparse
import sys
from sqlalchemy import select
from app.db.session import async_session_maker
from app.models import User


DEFAULT_ID = 1
DEFAULT_EMAIL = "classname1984@gmail.com"


async def make_admin(email: str | None = None, user_id: int | None = None) -> None:
    async with async_session_maker() as session:
        if email:
            result = await session.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
        elif user_id is not None:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
        else:
            result = await session.execute(select(User).where(User.id == DEFAULT_ID))
            user = result.scalar_one_or_none()
            if user is None:
                result = await session.execute(select(User).where(User.email == DEFAULT_EMAIL))
                user = result.scalar_one_or_none()

        if user is None:
            print("[ERROR] User not found. Please check the email or ID.")
            sys.exit(1)

        user.is_admin = True
        user.is_active = True
        await session.commit()
        print(f"[SUCCESS] User {user.email} is now an Admin!")


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote a user to Admin.")
    parser.add_argument("--email", type=str, help="User email address")
    parser.add_argument("--id", type=int, help="User ID")
    args = parser.parse_args()

    asyncio.run(make_admin(email=args.email, user_id=args.id))


if __name__ == "__main__":
    main()
