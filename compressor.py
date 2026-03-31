import asyncio
import copy
from anthropic import AsyncAnthropic

COMPRESSION_PROMPT = (
    "You are compressing a coding tool output to save tokens. "
    "Extract ONLY what's essential: errors, file paths, function names, "
    "test failures, key values, warnings. "
    "Be extremely concise, target under 150 tokens. "
    "Output only the compressed content, nothing else."
)


def get_tool_results(messages: list) -> list:
    """Returns [(msg_idx, block_idx, text)] for all tool_result blocks."""
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
                results.append((i, j, text))
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


async def haiku_compress(client: AsyncAnthropic, text: str) -> str:
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": f"{COMPRESSION_PROMPT}\n\n---\n{text[:4000]}"}],
    )
    return response.content[0].text


async def compress_messages(messages: list, api_key: str, config) -> tuple:
    """
    Compresses old tool_result blocks using Haiku.
    Returns (compressed_messages, savings_dict).
    """
    if config.disabled:
        return messages, {"compressed": 0, "saved_chars": 0}

    tool_results = get_tool_results(messages)

    # Keep the most recent N tool results intact
    candidates = tool_results[: -config.keep_recent] if len(tool_results) > config.keep_recent else []

    # Only compress blocks above the char threshold
    to_compress = [(i, j, text) for i, j, text in candidates if len(text) >= config.threshold]

    if not to_compress:
        return messages, {"compressed": 0, "saved_chars": 0}

    messages = copy.deepcopy(messages)
    client = AsyncAnthropic(api_key=api_key)

    compressed_texts = await asyncio.gather(
        *[haiku_compress(client, text) for _, _, text in to_compress],
        return_exceptions=True,
    )

    total_original = 0
    total_compressed = 0
    success_count = 0

    for (i, j, original), result in zip(to_compress, compressed_texts):
        if isinstance(result, Exception):
            continue
        ratio = round((1 - len(result) / max(len(original), 1)) * 100)
        set_text(messages[i]["content"][j], f"[squeezr -{ratio}%] {result}")
        total_original += len(original)
        total_compressed += len(result)
        success_count += 1

    return messages, {
        "compressed": success_count,
        "saved_chars": total_original - total_compressed,
        "original_chars": total_original,
        "compressed_chars": total_compressed,
    }
