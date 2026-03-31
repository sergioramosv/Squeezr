import os
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

from compressor import compress_messages
from config import Config
from stats import Stats, print_banner

config = Config()
stats = Stats()

ANTHROPIC_API = "https://api.anthropic.com"
SKIP_HEADERS = {"host", "content-length", "transfer-encoding", "connection"}
SKIP_RESPONSE_HEADERS = {"content-encoding", "transfer-encoding", "connection"}


def forward_headers(headers: dict) -> dict:
    return {k: v for k, v in headers.items() if k.lower() not in SKIP_HEADERS}


def estimate_chars(messages: list) -> int:
    import json
    return len(json.dumps(messages))


@asynccontextmanager
async def lifespan(app: FastAPI):
    print_banner(config.port)
    yield


app = FastAPI(lifespan=lifespan)


@app.post("/v1/messages")
async def proxy_messages(request: Request):
    body = await request.json()
    headers = dict(request.headers)
    api_key = headers.get("x-api-key", os.environ.get("ANTHROPIC_API_KEY", ""))

    messages = body.get("messages", [])
    original_chars = estimate_chars(messages)

    compressed_messages, savings = await compress_messages(messages, api_key, config)
    body["messages"] = compressed_messages

    stats.record(original_chars, estimate_chars(compressed_messages), savings)

    fwd_headers = forward_headers(headers)

    if body.get("stream", False):
        return StreamingResponse(
            _stream(body, fwd_headers),
            media_type="text/event-stream",
            headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
        )

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(f"{ANTHROPIC_API}/v1/messages", json=body, headers=fwd_headers)
        resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in SKIP_RESPONSE_HEADERS}
        return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)


async def _stream(body: dict, headers: dict):
    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream("POST", f"{ANTHROPIC_API}/v1/messages", json=body, headers=headers) as resp:
            async for chunk in resp.aiter_bytes():
                yield chunk


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(request: Request, path: str):
    """Forward any other Anthropic endpoint without modification."""
    body = await request.body()
    headers = forward_headers(dict(request.headers))

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.request(
            method=request.method,
            url=f"{ANTHROPIC_API}/{path}",
            content=body,
            headers=headers,
            params=dict(request.query_params),
        )
        resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in SKIP_RESPONSE_HEADERS}
        return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)


@app.get("/squeezr/stats")
async def get_stats():
    return stats.summary()


@app.get("/squeezr/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.port, log_level="warning")
