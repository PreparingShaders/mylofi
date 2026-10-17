"""
CLI script to clean up auto-generated test users from the database.

Deletes users with emails matching:
- test_*@example.com
- test_*@*.com

Usage:
    python -m app.db.clean_test_users
"""

import asyncio

from sqlalchemy import delete

from app.db.session import async_session_maker, init_db
from app.models import User


async def clean_test_users():
    """Delete test users matching the test patterns."""
    await init_db()

    async with async_session_maker() as db:
        # Delete test_*@example.com users
        result1 = await db.execute(delete(User).where(User.email.like('test_%@example.com')))
        count1 = result1.rowcount

        # Delete test_*@*.com users (catches test_*@gmail.com, test_*@test.com, etc.)
        result2 = await db.execute(delete(User).where(User.email.like('test_%@%.com')))
        count2 = result2.rowcount

        await db.commit()

        total = count1 + count2
        print(f"Deleted {count1} users matching 'test_%@example.com'")
        print(f"Deleted {count2} users matching 'test_%@%.com'")
        print(f"Total deleted: {total}")


if __name__ == "__main__":
    asyncio.run(clean_test_users())