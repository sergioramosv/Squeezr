import asyncio
import copy
import json

import httpx
from anthropic import AsyncAnthropic

from cache import CompressionCache

COMPRESSION_PROMPT = (
    "You are compressing a coding tool output to save tokens. "
    "Extract ONLY what's essential: errors, file paths, function names, "
    "test failures, key values, warnings. "
    "Be extremely concise, target under 150 tokens. "
    "Output only the compressed content, nothing else."
)

CONVERSATION_PROMPT = (
    "Summarize this coding conversation message in under 100 tokens. "
    "Keep: decisions made, code written, errors found, file paths. "
    "Output only the summary."
)

_cache: CompressionCache | None = None


def get_cache(config) -> CompressionCache:
    global _cache
    if _cache is None:
        _cache = CompressionCache(max_entries=config.cache_max_entries)
    return _cache


def build_tool_id_map(messages: list) -> dict:
    mapping = {}
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use":
                mapping[block.get("id", "")] = block.get("name", "unknown")
    return mapping


def get_tool_results(messages: list, tool_id_map: dict) -> list:
    results = []
    for i, msg in enumerate(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for j, block in enumerate(content):
            if block.get("type") != "tool_result":
                continue
            text = extract_text(block)
            if text:
                tool_name = tool_id_map.get(block.get("tool_use_id", ""), "unknown")
                results.append((i, j, text, tool_name))
    return results


def get_conversation_messages(messages: list) -> list:
    """Returns [(msg_idx, text, role)] for plain text user/assistant messages."""
    results = []
    for i, msg in enumerate(messages):
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content", "")
        if isinstance(content, str) and content:
            results.append((i, content, role))
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if text:
                        results.append((i, text, role))
    return results


def extract_text(block: dict) -> str:
    content = block.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text"]
        return "\n".join(parts)
    return ""


def set_text(block: dict, text: str):
    content = block.get("content", "")
    if isinstance(content, str):
        block["content"] = text
    else:
        block["content"] = [{"type": "text", "text": text}]


def estimate_context_pressure(messages: list, model: str = "") -> float:
    """Rough estimate of context fill (0.0-1.0) based on total chars."""
    total_chars = sum(len(str(m)) for m in messages)
    # ~4 chars per token, 200K token context = 800K chars
    return min(total_chars / 800_000, 1.0)


async def haiku_compress(client: AsyncAnthropic, text: str, prompt: str = COMPRESSION_PROMPT) -> str:
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": f"{prompt}\n\n---\n{text[:4000]}"}],
    )
    return response.content[0].text


async def compress_messages(messages: list, api_key: str, config) -> tuple:
    if config.disabled:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    cache = get_cache(config)
    pressure = estimate_context_pressure(messages)
    threshold = config.threshold_for_pressure(pressure)

    tool_id_map = build_tool_id_map(messages)
    tool_results = get_tool_results(messages, tool_id_map)

    candidates = tool_results[: -config.keep_recent] if len(tool_results) > config.keep_recent else []
    to_compress = [(i, j, text, tool) for i, j, text, tool in candidates if len(text) >= threshold]

    # Conversation messages compression (if enabled)
    conv_to_compress = []
    if config.compress_conversation:
        conv_msgs = get_conversation_messages(messages)
        conv_candidates = conv_msgs[: -config.keep_recent * 2] if len(conv_msgs) > config.keep_recent * 2 else []
        conv_to_compress = [(i, text, role) for i, text, role in conv_candidates if len(text) >= threshold]

    if not to_compress and not conv_to_compress:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    # Dry-run: report what would be compressed without modifying
    if config.dry_run:
        potential_saved = sum(len(text) for _, _, text, _ in to_compress)
        potential_saved += sum(len(text) for _, text, _ in conv_to_compress)
        print(
            f"[squeezr dry-run] Would compress {len(to_compress) + len(conv_to_compress)} block(s) "
            f"| potential -{potential_saved:,} chars | pressure={pressure:.0%} threshold={threshold}"
        )
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": True}

    messages = copy.deepcopy(messages)
    client = AsyncAnthropic(api_key=api_key)

    async def compress_one(text: str, prompt: str = COMPRESSION_PROMPT) -> str:
        if config.cache_enabled:
            cached = cache.get(text)
            if cached:
                return cached
        result = await haiku_compress(client, text, prompt)
        if config.cache_enabled:
            cache.set(text, result)
        return result

    # Compress tool results
    compressed_texts = await asyncio.gather(
        *[compress_one(text) for _, _, text, _ in to_compress],
        return_exceptions=True,
    )

    total_original = 0
    total_compressed_size = 0
    success_count = 0
    by_tool = []

    for (i, j, original, tool_name), result in zip(to_compress, compressed_texts):
        if isinstance(result, Exception):
            continue
        ratio = round((1 - len(result) / max(len(original), 1)) * 100)
        set_text(messages[i]["content"][j], f"[squeezr -{ratio}%] {result}")
        saved = len(original) - len(result)
        total_original += len(original)
        total_compressed_size += len(result)
        success_count += 1
        by_tool.append({"tool": tool_name, "saved_chars": saved, "original_chars": len(original)})

    # Compress conversation messages
    if conv_to_compress:
        conv_compressed = await asyncio.gather(
            *[compress_one(text, CONVERSATION_PROMPT) for _, text, _ in conv_to_compress],
            return_exceptions=True,
        )
        for (msg_idx, original, _), result in zip(conv_to_compress, conv_compressed):
            if isinstance(result, Exception):
                continue
            ratio = round((1 - len(result) / max(len(original), 1)) * 100)
            content = messages[msg_idx].get("content", "")
            summary = f"[squeezr conv -{ratio}%] {result}"
            if isinstance(content, str):
                messages[msg_idx]["content"] = summary
            else:
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        block["text"] = summary
                        break
            saved = len(original) - len(result)
            total_original += len(original)
            total_compressed_size += len(result)
            success_count += 1
            by_tool.append({"tool": "conversation", "saved_chars": saved, "original_chars": len(original)})

    if pressure >= 0.50:
        print(f"[squeezr] Context pressure: {pressure:.0%} \u2192 threshold={threshold} chars")

    return messages, {
        "compressed": success_count,
        "saved_chars": total_original - total_compressed_size,
        "original_chars": total_original,
        "compressed_chars": total_compressed_size,
        "by_tool": by_tool,
        "dry_run": False,
    }


# ── OpenAI / Codex format ─────────────────────────────────────────────────────

def build_openai_tool_name_map(messages: list) -> dict:
    """Maps tool_call_id -> function_name from OpenAI assistant messages."""
    mapping = {}
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        for tc in msg.get("tool_calls") or []:
            mapping[tc.get("id", "")] = tc.get("function", {}).get("name", "unknown")
    return mapping


def get_openai_tool_results(messages: list) -> list:
    """Returns [(msg_idx, content, tool_name)] for OpenAI tool messages."""
    tool_name_map = build_openai_tool_name_map(messages)
    results = []
    for i, msg in enumerate(messages):
        if msg.get("role") != "tool":
            continue
        content = msg.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                c.get("text", "") for c in content
                if isinstance(c, dict) and c.get("type") == "text"
            )
        if content:
            tool_name = tool_name_map.get(msg.get("tool_call_id", ""), "unknown")
            results.append((i, content, tool_name))
    return results


async def gpt_mini_compress(client, text: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=300,
        messages=[{"role": "user", "content": f"{COMPRESSION_PROMPT}\n\n---\n{text[:4000]}"}],
    )
    return response.choices[0].message.content


async def compress_openai_messages(messages: list, openai_key: str, config) -> tuple:  # noqa: E302
    """
    Compresses old tool messages in OpenAI/Codex format.
    Uses GPT-4o-mini (same OpenAI key from the request) — no extra keys needed.
    """
    if config.disabled or not openai_key:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    cache = get_cache(config)
    pressure = estimate_context_pressure(messages)
    threshold = config.threshold_for_pressure(pressure)

    tool_results = get_openai_tool_results(messages)
    candidates = tool_results[: -config.keep_recent] if len(tool_results) > config.keep_recent else []
    to_compress = [(i, text, tool) for i, text, tool in candidates if len(text) >= threshold]

    if not to_compress:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    if config.dry_run:
        potential = sum(len(t) for _, t, _ in to_compress)
        print(
            f"[squeezr dry-run/codex] Would compress {len(to_compress)} block(s) "
            f"| potential -{potential:,} chars | pressure={pressure:.0%} threshold={threshold}"
        )
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": True}

    messages = copy.deepcopy(messages)

    from openai import AsyncOpenAI
    oai_client = AsyncOpenAI(api_key=openai_key)

    async def compress_one(text: str) -> str:
        if config.cache_enabled:
            cached = cache.get(text)
            if cached:
                return cached
        result = await gpt_mini_compress(oai_client, text)
        if config.cache_enabled:
            cache.set(text, result)
        return result

    compressed_texts = await asyncio.gather(
        *[compress_one(text) for _, text, _ in to_compress],
        return_exceptions=True,
    )

    total_original = 0
    total_compressed_size = 0
    success_count = 0
    by_tool = []

    for (i, original, tool_name), result in zip(to_compress, compressed_texts):
        if isinstance(result, Exception):
            continue
        ratio = round((1 - len(result) / max(len(original), 1)) * 100)
        messages[i]["content"] = f"[squeezr -{ratio}%] {result}"
        saved = len(original) - len(result)
        total_original += len(original)
        total_compressed_size += len(result)
        success_count += 1
        by_tool.append({"tool": tool_name, "saved_chars": saved, "original_chars": len(original)})

    if pressure >= 0.50:
        print(f"[squeezr/codex] Context pressure: {pressure:.0%} \u2192 threshold={threshold} chars")

    return messages, {
        "compressed": success_count,
        "saved_chars": total_original - total_compressed_size,
        "original_chars": total_original,
        "compressed_chars": total_compressed_size,
        "by_tool": by_tool,
        "dry_run": False,
    }


# ── Ollama / local LLMs ───────────────────────────────────────────────────────

async def compress_local_messages(messages: list, config) -> tuple:
    """
    Compresses old tool messages using a local Ollama model.
    Uses the OpenAI-compatible endpoint that Ollama exposes at /v1/chat/completions.
    Model is fully configurable in squeezr.toml [local] compression_model.
    """
    if config.disabled:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    cache = get_cache(config)
    pressure = estimate_context_pressure(messages)
    threshold = config.threshold_for_pressure(pressure)

    # Reuse OpenAI tool result extraction — Ollama uses the same format
    tool_results = get_openai_tool_results(messages)
    candidates = tool_results[: -config.keep_recent] if len(tool_results) > config.keep_recent else []
    to_compress = [(i, text, tool) for i, text, tool in candidates if len(text) >= threshold]

    if not to_compress:
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    if config.dry_run:
        potential = sum(len(t) for _, t, _ in to_compress)
        print(
            f"[squeezr dry-run/ollama] Would compress {len(to_compress)} block(s) "
            f"| potential -{potential:,} chars | model={config.local_compression_model}"
        )
        return messages, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": True}

    messages = copy.deepcopy(messages)

    # Ollama exposes an OpenAI-compatible endpoint — just point the client at it
    from openai import AsyncOpenAI
    ollama_client = AsyncOpenAI(
        api_key="ollama",
        base_url=f"{config.local_upstream_url.rstrip('/')}/v1",
    )

    async def compress_one(text: str) -> str:
        if config.cache_enabled:
            cached = cache.get(text)
            if cached:
                return cached
        response = await ollama_client.chat.completions.create(
            model=config.local_compression_model,
            max_tokens=300,
            messages=[{"role": "user", "content": f"{COMPRESSION_PROMPT}\n\n---\n{text[:4000]}"}],
        )
        result = response.choices[0].message.content
        if config.cache_enabled:
            cache.set(text, result)
        return result

    compressed_texts = await asyncio.gather(
        *[compress_one(text) for _, text, _ in to_compress],
        return_exceptions=True,
    )

    total_original = 0
    total_compressed_size = 0
    success_count = 0
    by_tool = []

    for (i, original, tool_name), result in zip(to_compress, compressed_texts):
        if isinstance(result, Exception):
            print(f"[squeezr/ollama] Compression failed ({tool_name}): {result}")
            continue
        ratio = round((1 - len(result) / max(len(original), 1)) * 100)
        messages[i]["content"] = f"[squeezr -{ratio}%] {result}"
        saved = len(original) - len(result)
        total_original += len(original)
        total_compressed_size += len(result)
        success_count += 1
        by_tool.append({"tool": tool_name, "saved_chars": saved, "original_chars": len(original)})

    if pressure >= 0.50:
        print(f"[squeezr/ollama] Context pressure: {pressure:.0%} \u2192 threshold={threshold} chars")

    return messages, {
        "compressed": success_count,
        "saved_chars": total_original - total_compressed_size,
        "original_chars": total_original,
        "compressed_chars": total_compressed_size,
        "by_tool": by_tool,
        "dry_run": False,
    }


# ── Google Gemini CLI format ───────────────────────────────────────────────────

def get_gemini_tool_results(contents: list) -> list:
    """
    Returns [(content_idx, part_idx, text, tool_name)] for Gemini functionResponse parts.
    Gemini tool results live in role='user' contents as parts[i].functionResponse.
    """
    results = []
    for i, content in enumerate(contents):
        if content.get("role") != "user":
            continue
        for j, part in enumerate(content.get("parts", [])):
            if "functionResponse" not in part:
                continue
            fn_resp = part["functionResponse"]
            tool_name = fn_resp.get("name", "unknown")
            response_val = fn_resp.get("response", {})
            text = json.dumps(response_val) if isinstance(response_val, dict) else str(response_val)
            if text:
                results.append((i, j, text, tool_name))
    return results


async def gemini_flash_compress(text: str, api_key: str) -> str:
    url = (
        "https://generativelanguage.googleapis.com"
        "/v1beta/models/gemini-1.5-flash-8b:generateContent"
        f"?key={api_key}"
    )
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{COMPRESSION_PROMPT}\n\n---\n{text[:4000]}"}]}
        ]
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


async def compress_gemini_contents(contents: list, google_key: str, config) -> tuple:
    """
    Compresses old functionResponse parts in Gemini format.
    Uses Gemini Flash 8B (cheapest Google model) — reuses the key from the request.
    """
    if config.disabled or not google_key:
        return contents, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    cache = get_cache(config)
    pressure = estimate_context_pressure(contents)
    threshold = config.threshold_for_pressure(pressure)

    tool_results = get_gemini_tool_results(contents)
    candidates = tool_results[: -config.keep_recent] if len(tool_results) > config.keep_recent else []
    to_compress = [(i, j, text, tool) for i, j, text, tool in candidates if len(text) >= threshold]

    if not to_compress:
        return contents, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": False}

    if config.dry_run:
        potential = sum(len(t) for _, _, t, _ in to_compress)
        print(
            f"[squeezr dry-run/gemini] Would compress {len(to_compress)} block(s) "
            f"| potential -{potential:,} chars | pressure={pressure:.0%} threshold={threshold}"
        )
        return contents, {"compressed": 0, "saved_chars": 0, "by_tool": [], "dry_run": True}

    contents = copy.deepcopy(contents)

    async def compress_one(text: str) -> str:
        if config.cache_enabled:
            cached = cache.get(text)
            if cached:
                return cached
        result = await gemini_flash_compress(text, google_key)
        if config.cache_enabled:
            cache.set(text, result)
        return result

    compressed_texts = await asyncio.gather(
        *[compress_one(text) for _, _, text, _ in to_compress],
        return_exceptions=True,
    )

    total_original = 0
    total_compressed_size = 0
    success_count = 0
    by_tool = []

    for (i, j, original, tool_name), result in zip(to_compress, compressed_texts):
        if isinstance(result, Exception):
            continue
        ratio = round((1 - len(result) / max(len(original), 1)) * 100)
        contents[i]["parts"][j]["functionResponse"]["response"] = {
            "output": f"[squeezr -{ratio}%] {result}"
        }
        saved = len(original) - len(result)
        total_original += len(original)
        total_compressed_size += len(result)
        success_count += 1
        by_tool.append({"tool": tool_name, "saved_chars": saved, "original_chars": len(original)})

    if pressure >= 0.50:
        print(f"[squeezr/gemini] Context pressure: {pressure:.0%} \u2192 threshold={threshold} chars")

    return contents, {
        "compressed": success_count,
        "saved_chars": total_original - total_compressed_size,
        "original_chars": total_original,
        "compressed_chars": total_compressed_size,
        "by_tool": by_tool,
        "dry_run": False,
    }
