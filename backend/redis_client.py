import os
import redis
import json
from typing import Optional, Any

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

class RedisClient:
    def __init__(self):
        self._client = redis.from_url(REDIS_URL, decode_responses=True)

    def set(self, key: str, value: Any, expire: Optional[int] = None):
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        self._client.set(key, value, ex=expire)

    def get(self, key: str) -> Optional[Any]:
        value = self._client.get(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None

    def delete(self, key: str):
        self._client.delete(key)

    def hset(self, name: str, key: str, value: Any):
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        self._client.hset(name, key, value)

    def hget(self, name: str, key: str) -> Optional[Any]:
        value = self._client.hget(name, key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None

    def hgetall(self, name: str) -> dict:
        data = self._client.hgetall(name)
        result = {}
        for k, v in data.items():
            try:
                result[k] = json.loads(v)
            except json.JSONDecodeError:
                result[k] = v
        return result

redis_client = RedisClient()

