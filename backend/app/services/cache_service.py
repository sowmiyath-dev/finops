"""Shared Redis cache — replaces per-process in-memory dicts.
All 4 uvicorn workers share one cache so there are no duplicate misses.
Falls back to a simple in-memory dict if Redis is unavailable.
"""
import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_redis = None
_fallback: dict = {}  # in-memory fallback if Redis is down


async def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        await _redis.ping()
        logger.info("Redis cache connected")
    except Exception as e:
        logger.warning(f"Redis unavailable, using in-memory fallback: {e}")
        _redis = None
    return _redis


async def cache_get(key: str) -> Optional[Any]:
    try:
        r = await _get_redis()
        if r:
            val = await r.get(key)
            return json.loads(val) if val else None
    except Exception:
        pass
    # fallback
    entry = _fallback.get(key)
    if entry and time.time() < entry["exp"]:
        return entry["d"]
    return None


async def cache_set(key: str, data: Any, ttl: int = 300) -> None:
    try:
        r = await _get_redis()
        if r:
            await r.setex(key, ttl, json.dumps(data, default=str))
            return
    except Exception:
        pass
    # fallback
    _fallback[key] = {"d": data, "exp": time.time() + ttl}


async def cache_delete_pattern(pattern: str) -> None:
    """Delete all keys matching a pattern (e.g. 'az_overview_*')."""
    try:
        r = await _get_redis()
        if r:
            keys = await r.keys(pattern)
            if keys:
                await r.delete(*keys)
            return
    except Exception:
        pass
    # fallback
    to_del = [k for k in _fallback if _match_pattern(k, pattern)]
    for k in to_del:
        _fallback.pop(k, None)


def _match_pattern(key: str, pattern: str) -> bool:
    if pattern.endswith("*"):
        return key.startswith(pattern[:-1])
    return key == pattern
