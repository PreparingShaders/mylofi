#!/usr/bin/env python3
"""
Seed script to create test users for E2E testing.

Creates two users:
- free_user@mylofi.test (is_premium=False)
- premium_user@mylofi.test (is_premium=True)

Both with password: Password123!
"""

import asyncio
from sqlalchemy import select
from app.db.session import async_session_maker, init_db
from app.models import User
from app.services.auth import get_password_hash


async def seed_test_users():
    """Create test users if they don't exist."""
    await init_db()

    async with async_session_maker() as db:
        # Check if users already exist
        free_user_email = "free_user@mylofi.test"
        premium_user_email = "premium_user@mylofi.test"

        for email in [free_user_email, premium_user_email]:
            result = await db.execute(select(User).where(User.email == email))
            existing = result.scalar_one_or_none()
            if existing:
                print(f"User {email} already exists, skipping")
                continue

        # Create free user
        free_result = await db.execute(select(User).where(User.email == free_user_email))
        if not free_result.scalar_one_or_none():
            free_user = User(
                email=free_user_email,
                hashed_password=get_password_hash("Password123!"),
                full_name="Free Test User",
                is_premium=False,
                is_active=True,
            )
            db.add(free_user)
            print(f"Created free user: {free_user_email}")

        # Create premium user
        premium_result = await db.execute(select(User).where(User.email == premium_user_email))
        if not premium_result.scalar_one_or_none():
            premium_user = User(
                email=premium_user_email,
                hashed_password=get_password_hash("Password123!"),
                full_name="Premium Test User",
                is_premium=True,
                is_active=True,
            )
            db.add(premium_user)
            print(f"Created premium user: {premium_user_email}")

        await db.commit()
        print("Test users seeded successfully!")


if __name__ == "__main__":
    asyncio.run(seed_test_users())