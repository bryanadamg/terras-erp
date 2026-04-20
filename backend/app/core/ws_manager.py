from typing import List
from fastapi import WebSocket
import asyncio
import json
import os
import logging
from redis import asyncio as aioredis

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis: aioredis.Redis | None = None
        self.pubsub: aioredis.client.PubSub | None = None
        self._listener_task: asyncio.Task | None = None
        self.channel_name = "terras_events"

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def initialize(self):
        """Initializes Redis connection and PubSub listener."""
        try:
            self.redis = aioredis.from_url(self.redis_url, decode_responses=True)
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe(self.channel_name)
            self._listener_task = asyncio.create_task(self._listen_to_redis())
            logger.info(f"WebSocket manager initialized with Redis: {self.redis_url}")
        except Exception as e:
            logger.error(f"Failed to initialize Redis for WebSockets: {e}")

    async def stop(self):
        """Stops the listener and closes Redis."""
        if self._listener_task:
            self._listener_task.cancel()
        if self.pubsub:
            await self.pubsub.unsubscribe(self.channel_name)
            await self.pubsub.close()
        if self.redis:
            await self.redis.close()

    async def _listen_to_redis(self):
        """Internal task to listen for Redis messages and broadcast to local clients."""
        try:
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await self._local_broadcast(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Redis listener encountered error: {e}")
            await asyncio.sleep(5)
            # Re-initialize on failure
            asyncio.create_task(self.initialize())

    async def _local_broadcast(self, message: dict):
        """Broadcasts to connections on THIS server instance."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

    async def broadcast(self, message: dict):
        """
        Global broadcast: Publishes to Redis.
        The listener on each instance will pick it up and broadcast locally.
        """
        if self.redis:
            try:
                await self.redis.publish(self.channel_name, json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to publish to Redis: {e}")
                # Fallback to local broadcast if Redis is down
                await self._local_broadcast(message)
        else:
            await self._local_broadcast(message)

manager = ConnectionManager()
