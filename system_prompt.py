import hashlib
import json
from pathlib import Path
from anthropic import AsyncAnthropic

CACHE_FILE = Path.home() / ".squeezr" / "sysprompt_cache.json"
MIN_LENGTH = 2000

COMPRESSION_PROMPT = (
    "Compress this AI assistant system prompt to under 600 tokens. "
    "Keep: tool names, behavioral rules, key constraints, critical instructions. "
    "Remove: verbose examples, repetitive explanations, formatting guides, long documentation. "
    "Output only the compressed prompt, preserving its original format."
)


def _key(prompt: str) -> str:
    return hashlib.md5(prompt.encode("utf-8")).hexdigest()


def _load_cache() -> dict:
    try:
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_cache(cache: dict):
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")
    except Exception:
        pass


async def maybe_compress_system_prompt(prompt: str | None, api_key: str, use_openai: bool = False, use_google: bool = False) -> str | None:
    """
    Compress a system prompt using Haiku (Anthropic) or GPT-4o-mini (OpenAI).
    use_openai=True is used for Codex requests, reusing the OpenAI key from the request.
    """
    if not prompt or len(prompt) < MIN_LENGTH:
        return prompt

    cache = _load_cache()
    k = _key(prompt)

    if k in cache:
        return cache[k]

    try:
        if use_google:
            import httpx
            url = (
                "https://generativelanguage.googleapis.com"
                f"/v1beta/models/gemini-1.5-flash-8b:generateContent?key={api_key}"
            )
            payload = {
                "contents": [
                    {"role": "user", "parts": [{"text": f"{COMPRESSION_PROMPT}\n\n---\n{prompt[:10000]}"}]}
                ]
            }
            async with httpx.AsyncClient(timeout=30) as hclient:
                resp = await hclient.post(url, json=payload)
                resp.raise_for_status()
                compressed = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            tag = "gemini/flash-8b"
        elif use_openai:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key)
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=700,
                messages=[{"role": "user", "content": f"{COMPRESSION_PROMPT}\n\n---\n{prompt[:10000]}"}],
            )
            compressed = response.choices[0].message.content
            tag = "codex/gpt-4o-mini"
        else:
            client = AsyncAnthropic(api_key=api_key)
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=700,
                messages=[{"role": "user", "content": f"{COMPRESSION_PROMPT}\n\n---\n{prompt[:10000]}"}],
            )
            compressed = response.content[0].text
            tag = "haiku"

        ratio = round((1 - len(compressed) / len(prompt)) * 100)
        print(f"[squeezr/{tag}] System prompt compressed: -{ratio}% ({len(prompt):,} \u2192 {len(compressed):,} chars) [cached]")
        cache[k] = compressed
        _save_cache(cache)
        return compressed
    except Exception:
        return prompt
