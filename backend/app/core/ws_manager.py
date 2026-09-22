from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List
from fastapi import WebSocket
import asyncio
import json
import os
import time
import logging
from redis import asyncio as aioredis

from app.core.ws_events import can_receive, wants_topic
from app.core.ws_metrics import metrics

logger = logging.getLogger(__name__)

# Close code sent when a connection's JWT expires mid-session. Distinct from
# 1008 (token was never valid) so the client can tell "log in again" from
# "your session just aged out" — and stop reconnecting on either.
WS_CLOSE_TOKEN_EXPIRED = 4001
# 1013 "try again later" — sent to a client whose send queue overflowed. It is
# dropped rather than waited on; it reconnects and resyncs (the client refetches
# the current route on every re-handshake), which is strictly better than holding
# up the fan-out for everyone else on this worker.
WS_CLOSE_BACKPRESSURE = 1013

# Per-connection outbound buffer. Deep enough to absorb a burst (a production run
# creating dozens of MOs) without dropping a healthy client; shallow enough that a
# stalled one is detected in seconds rather than accumulating unbounded memory.
SEND_QUEUE_MAXSIZE = 128


@dataclass
class ConnectionState:
    """Identity of one authenticated socket.

    `perms` is a SNAPSHOT taken at connect, not re-read per event: a broadcast
    fans out to every connection, and a query per connection per event would put
    the permission table on the hot path of every mutation in the system. The
    cost is that a permission change lands on that user's next connect; the
    JWT's own expiry (<=24h, and enforced below) bounds how long that can drift.
    """
    user_id: str
    username: str
    perms: set[str] = field(default_factory=set)
    expires_at: datetime | None = None
    # What this connection's CURRENT screen needs, set by a client subscribe
    # frame and re-sent on navigation. None = "hasn't told us", which delivers
    # everything the permissions allow — never the empty set by default, or a
    # client that connects and never subscribes would go silently deaf.
    topics: set[str] | None = None
    # Outbound buffer + the task draining it. The broadcast path only enqueues, so
    # one client on a stalled TCP connection can no longer hold up delivery to
    # everyone else on this worker — which is what a sequential `await send_json`
    # across all connections did.
    # Items are (enqueued_at_monotonic, message) so the writer can measure how long
    # delivery actually lagged behind the mutation that caused it.
    queue: "asyncio.Queue[tuple[float, dict]]" = field(
        default_factory=lambda: asyncio.Queue(maxsize=SEND_QUEUE_MAXSIZE)
    )
    writer: "asyncio.Task | None" = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, ConnectionState] = {}
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis: aioredis.Redis | None = None
        self.pubsub: aioredis.client.PubSub | None = None
        self._listener_task: asyncio.Task | None = None
        self.channel_name = "terras_events"
        self._invalidation_hooks: List[callable] = []

    def register_invalidation_hook(self, fn: callable):
        """Run fn(message) on every broadcast this instance receives (local or via
        Redis), so a request-scoped in-process cache can drop itself when the data
        it holds changed — without a dedicated pub/sub subscription per cache."""
        self._invalidation_hooks.append(fn)

    async def connect(self, websocket: WebSocket, state: ConnectionState):
        """Join the broadcast pool. The caller MUST have accepted the socket and
        authenticated it first (see the /ws/events endpoint) — this manager has
        no way to identify an anonymous connection, and an unidentified one would
        have to be handed either everything or nothing."""
        state.writer = asyncio.create_task(self._writer_loop(websocket, state))
        self.active_connections[websocket] = state
        metrics.connections_opened += 1

    def disconnect(self, websocket: WebSocket):
        state = self.active_connections.pop(websocket, None)
        if state and state.writer:
            state.writer.cancel()
            state.writer = None
        if state:
            metrics.connections_closed += 1

    async def _writer_loop(self, websocket: WebSocket, state: ConnectionState):
        """Drain one connection's queue. Owns every send to that socket."""
        try:
            while True:
                enqueued_at, message = await state.queue.get()
                await websocket.send_json(message)
                metrics.send_lag.observe(time.monotonic() - enqueued_at)
        except asyncio.CancelledError:
            raise
        except Exception:
            # The socket is gone. The receive loop may never notice on its own —
            # a half-open TCP connection reads nothing — so reap it here. Popped
            # directly rather than via disconnect(): that would cancel this very
            # task, and it is already on its way out.
            metrics.send_errors += 1
            if self.active_connections.pop(websocket, None) is not None:
                metrics.connections_closed += 1

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
        for state in list(self.active_connections.values()):
            if state.writer:
                state.writer.cancel()
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
        """Broadcasts to connections on THIS server instance, filtered per user."""
        # Cache invalidation runs first and unconditionally: it is server-side
        # state, so it must not depend on who happens to be connected.
        for fn in self._invalidation_hooks:
            try:
                fn(message)
            except Exception:
                pass

        event_type = message.get("type") or ""
        now = datetime.now(timezone.utc)
        # (connection, close_code) — closed after the loop so the dict isn't
        # mutated while iterating it.
        drop: list[tuple[WebSocket, int]] = []

        for connection, state in list(self.active_connections.items()):
            if state.expires_at and state.expires_at <= now:
                drop.append((connection, WS_CLOSE_TOKEN_EXPIRED))
                continue
            # Permission decides what this user MAY see; topics what their screen
            # needs. Permission first — it is the security check, and it must not
            # be skippable by a client that simply declines to subscribe.
            if not can_receive(event_type, state.perms):
                metrics.filtered_permission += 1
                continue
            if not wants_topic(event_type, state.topics):
                metrics.filtered_topic += 1
                continue
            try:
                # Enqueue, never await the socket: this loop runs inside the
                # request that made the change, so a single unresponsive client
                # awaiting here would stall the mutation AND every other client's
                # event behind it.
                state.queue.put_nowait((time.monotonic(), message))
                metrics.deliveries += 1
                metrics.note_queue_depth(state.queue.qsize())
            except asyncio.QueueFull:
                logger.warning(
                    "WebSocket send queue full for user %s; dropping connection", state.username
                )
                drop.append((connection, WS_CLOSE_BACKPRESSURE))

        for connection, code in drop:
            self.disconnect(connection)
            if code == WS_CLOSE_BACKPRESSURE:
                metrics.closed_backpressure += 1
            elif code == WS_CLOSE_TOKEN_EXPIRED:
                metrics.closed_token_expired += 1
            try:
                await connection.close(code=code)
            except Exception:
                pass

    async def broadcast(self, message: dict):
        """
        Global broadcast: record the event, then publish it to Redis.
        The listener on each instance picks it up and broadcasts locally.

        Recording first is what makes the feed recoverable: the row carries the
        `seq` clients resume from, and a publish that fails leaves it unpublished
        for the relay to retry. Recording is best-effort — if the database is
        unavailable the event still goes out, just without a cursor.
        """
        from app.services import event_log_service  # deferred: models import late

        started = time.monotonic()
        seq = await event_log_service.record(message)
        if seq is not None:
            message = {**message, "seq": seq}
        else:
            metrics.events_unrecorded += 1

        if self.redis:
            try:
                await self.redis.publish(self.channel_name, json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to publish to Redis: {e}")
                metrics.publish_failures += 1
                # Reaches only the sockets on THIS worker. The row stays
                # unpublished so the relay re-sends it to everyone else.
                await self._local_broadcast(message)
                metrics.broadcast_time.observe(time.monotonic() - started)
                return
        else:
            await self._local_broadcast(message)

        if seq is not None:
            await event_log_service.mark_published([seq])
        metrics.events_published += 1
        metrics.broadcast_time.observe(time.monotonic() - started)

    async def relay_unpublished(self) -> int:
        """Re-publish events that never made it onto the bus. Returns how many."""
        from app.services import event_log_service

        if not self.redis:
            return 0
        rows = await event_log_service.unpublished()
        sent: list[int] = []
        for seq, payload in rows:
            try:
                await self.redis.publish(self.channel_name, json.dumps(payload))
                sent.append(seq)
            except Exception:
                # Bus still down; leave the rest for the next pass.
                break
        if sent:
            await event_log_service.mark_published(sent)
            metrics.events_relayed += len(sent)
            logger.info("Relayed %d previously unpublished live events", len(sent))
        return len(sent)

manager = ConnectionManager()


def broadcast_sync(message: dict) -> None:
    """Broadcast from a SYNC endpoint.

    The master-data routers (attributes, uoms, locations, routing, partners) are
    `def` + `Session`, so they cannot await `manager.broadcast`. FastAPI runs a
    sync endpoint in a worker thread bound to the running event loop, which is
    exactly what `anyio.from_thread.run` needs — the coroutine executes on the
    loop and this thread waits for it.

    Best-effort by design: a live event is a refresh hint, and a mutation that
    already committed must not fail because the bus was unreachable. Outside a
    worker thread (a script, a startup task) there is no loop to borrow and the
    event is logged and dropped.
    """
    import anyio.from_thread

    try:
        anyio.from_thread.run(manager.broadcast, message)
    except Exception as e:
        logger.warning("Sync broadcast of %s dropped: %s", message.get("type"), e)
