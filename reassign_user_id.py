import asyncio
from sqlalchemy import text
from app.db.session import async_session_maker


async def main():
    async with async_session_maker() as session:
        try:
            # 1. Disable triggers/FK checks temporarily in PostgreSQL session
            await session.execute(text("SET session_replication_role = 'replica';"))

            # 2. Delete existing user with id = 1 if present (and clean up related tables)
            await session.execute(text("DELETE FROM refresh_tokens WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM workout_sessions WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM workout_templates WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM meals WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM daily_summaries WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM exercise_catalog WHERE user_id = 1;"))
            await session.execute(text("DELETE FROM users WHERE id = 1;"))

            # 3. Reassign user id = 21 to id = 1 and set admin privileges
            await session.execute(
                text("UPDATE users SET id = 1, is_admin = true, is_active = true WHERE id = 21;")
            )

            # 4. Update foreign key references for user 21 -> 1
            await session.execute(text("UPDATE refresh_tokens SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE workout_sessions SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE workout_templates SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE meals SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE daily_summaries SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE exercise_catalog SET user_id = 1 WHERE user_id = 21;"))

            # 5. Reset auto-increment sequence to avoid PK conflicts on new users
            await session.execute(text("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));"))

            await session.commit()
            print("[SUCCESS] User id reassigned from 21 to 1, collision cleared, sequence reset, and granted Admin privileges!")
        except Exception as e:
            await session.rollback()
            print(f"[ERROR] Reassignment failed: {e}")
            raise
        finally:
            # Always restore session replication role so FK checks stay enabled
            await session.execute(text("SET session_replication_role = 'origin';"))
            await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
