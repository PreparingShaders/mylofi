import json
import asyncio
from typing import Dict, Set, Optional
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meal, MealStatus
from app.schemas import WSMessage, WSMessageType, WSMealUpdatePayload


class ConnectionManager:
    def __init__(self):
        # user_id -> set of WebSocket connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        # WebSocket -> user_id (for quick lookup on disconnect)
        self.connection_user: Dict[WebSocket, int] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        self.connection_user[websocket] = user_id

    def disconnect(self, websocket: WebSocket):
        user_id = self.connection_user.pop(websocket, None)
        if user_id and user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: WSMessage, user_id: int):
        if user_id not in self.active_connections:
            return

        disconnected = set()
        for connection in self.active_connections[user_id]:
            try:
                await connection.send_text(message.model_dump_json())
            except Exception:
                disconnected.add(connection)

        # Clean up disconnected connections
        for conn in disconnected:
            self.disconnect(conn)

    async def broadcast(self, message: WSMessage):
        """Broadcast to all connected users"""
        for user_id in list(self.active_connections.keys()):
            await self.send_personal_message(message, user_id)

    async def notify_meal_update(
        self,
        db: AsyncSession,
        meal_id: int,
        status: MealStatus,
        **kwargs
    ):
        """Notify user about meal status update"""
        # Get meal with user_id
        from sqlalchemy import select
        result = await db.execute(select(Meal).where(Meal.id == meal_id))
        meal = result.scalar_one_or_none()
        if not meal:
            return

        payload = WSMealUpdatePayload(
            meal_id=meal_id,
            status=status,
            **kwargs
        )

        message = WSMessage(type=WSMessageType.MEAL_UPDATE, payload=payload.model_dump())
        await self.send_personal_message(message, meal.user_id)


manager = ConnectionManager()


async def get_websocket_user(
    websocket: WebSocket,
    db: AsyncSession,
    token: str
) -> Optional[int]:
    """Extract and validate user from WebSocket token query param"""
    from app.services.auth import decode_token, validate_refresh_token
    from app.models import User
    from sqlalchemy import select

    # Try to decode as access token first
    payload = decode_token(token)
    if payload and payload.type == "access":
        try:
            user_id = int(payload.sub)
            result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
            user = result.scalar_one_or_none()
            if user:
                return user_id
        except (ValueError, TypeError):
            pass

    return None