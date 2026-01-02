import socketio
import logging
from typing import Optional
from backend.redis_client import REDIS_URL

log = logging.getLogger("websockets")

# Use Redis manager for scalability (multiple backend nodes)
mgr = socketio.AsyncRedisManager(REDIS_URL)
sio = socketio.AsyncServer(
    async_mode='asgi',
    client_manager=mgr,
    cors_allowed_origins='*'
)

@sio.event
async def connect(sid, environ):
    log.info(f"WebSocket client connected: {sid}")
    # You could perform auth here using token in query string or headers

@sio.event
async def disconnect(sid):
    log.info(f"WebSocket client disconnected: {sid}")

@sio.event
async def register_robot(sid, data):
    robot_id = data.get("robot_id")
    if robot_id:
        await sio.enter_room(sid, f"robot_{robot_id}")
        log.info(f"Robot {robot_id} joined room robot_{robot_id}")

async def notify_robot_new_job(robot_id: int, job_id: int):
    await sio.emit("new_job", {"job_id": job_id}, room=f"robot_{robot_id}")

async def notify_robot_cancel_job(robot_id: int, job_id: int):
    await sio.emit("cancel_job", {"job_id": job_id}, room=f"robot_{robot_id}")

