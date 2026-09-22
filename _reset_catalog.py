import asyncio
import sys
import logging

logging.disable(logging.CRITICAL)
sys.path.insert(0, ".")

from sqlalchemy import delete, select, func
from app.db.session import async_session_maker
from app.models import ExerciseCatalog
from app.services.workout import seed_exercise_catalog


async def main():
    async with async_session_maker() as db:
        await db.execute(
            delete(ExerciseCatalog).where(ExerciseCatalog.user_id.is_(None))
        )
        await db.commit()
        await seed_exercise_catalog(db)
        count = await db.scalar(select(func.count(ExerciseCatalog.id)))
        personal = await db.scalar(
            select(func.count(ExerciseCatalog.id)).where(
                ExerciseCatalog.user_id.is_not(None)
            )
        )
        print("catalog rows:", count)
        print("personal rows:", personal)


asyncio.run(main())
