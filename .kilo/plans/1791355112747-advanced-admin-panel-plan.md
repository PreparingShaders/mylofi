# Reassign User ID 21 to 1 & Admin Promotion Plan

## Goal
Update `reassign_user_id.py` to reassign the user from ID 21 (`classname1984@gmail.com`) to ID 1, safely remove any collision at ID 1, update foreign keys, reset PostgreSQL sequence `users_id_seq`, ensure robust error handling with a `finally` block restoring `session_replication_role = 'origin'`, and promote the user to `is_admin = True`, `is_active = True`.

## Scope & Boundaries
- **In Scope:**
  - Plan implementation of `reassign_user_id.py` for ID 21 -> ID 1.
  - Deletion of existing `id=1` dummy user and dependent rows.
  - Temporary FK disable via `SET session_replication_role = 'replica';`.
  - Updating `users` and all FK tables (`refresh_tokens`, `workout_sessions`, `workout_templates`, `meals`, `daily_summaries`, `exercise_catalog`).
  - Sequence reset: `SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));`.
  - `finally` block ensuring `SET session_replication_role = 'origin';` always runs.
- **Out of Scope (for Plan Mode):**
  - Direct file modification or command execution (requires implementation agent).

## Implementation Design for `reassign_user_id.py`

```python
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
            await session.execute(text("UPDATE users SET id = 1, is_admin = true, is_active = true WHERE id = 21;"))
            
            # 4. Update foreign key references for user 21 -> 1
            await session.execute(text("UPDATE refresh_tokens SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE workout_sessions SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE workout_templates SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE meals SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE daily_summaries SET user_id = 1 WHERE user_id = 21;"))
            await session.execute(text("UPDATE exercise_catalog SET user_id = 1 WHERE user_id = 21;"))

            # 5. Reset auto-increment sequence
            await session.execute(text("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));"))
            
            await session.commit()
            print("[SUCCESS] User id reassigned from 21 to 1, collision cleared, sequence reset, and granted Admin privileges!")
        except Exception as e:
            await session.rollback()
            print(f"[ERROR] Reassignment failed: {e}")
            raise
        finally:
            # Always restore session replication role
            await session.execute(text("SET session_replication_role = 'origin';"))
            await session.commit()

if __name__ == "__main__":
    asyncio.run(main())
```

## Validation & Execution Steps
1. Switch to an implementation-capable agent to update and run `reassign_user_id.py`.
2. Verify table state and sequence in PostgreSQL.
