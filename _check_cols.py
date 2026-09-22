import asyncio, sys, logging
logging.disable(logging.CRITICAL)
sys.path.insert(0, '.')
from sqlalchemy import text
from app.db.session import engine

async def main():
    async with engine.connect() as conn:
        q = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='exercise_catalog' ORDER BY ordinal_position"
        )
        r = await conn.execute(q)
        cols = [row[0] for row in r]
        print('exercise_catalog columns:', cols)
        q2 = text("SELECT count(*) FROM exercise_catalog")
        c = await conn.execute(q2)
        print('row count:', c.scalar())

asyncio.run(main())
