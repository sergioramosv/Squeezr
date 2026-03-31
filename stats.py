import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

STATS_FILE = Path.home() / ".squeezr" / "stats.json"
CHARS_PER_TOKEN = 3.5


def chars_to_tokens(chars: int) -> float:
    return chars / CHARS_PER_TOKEN


def efficiency_bar(pct: float, width: int = 24) -> str:
    filled = round(width * pct / 100)
    empty = width - filled
    return "\u2588" * filled + "\u2591" * empty


@dataclass
class Stats:
    requests: int = 0
    total_original_chars: int = 0
    total_compressed_chars: int = 0
    total_compressions: int = 0
    by_tool: dict = field(default_factory=dict)
    session_start: float = field(default_factory=time.time)

    def record(self, original_chars: int, compressed_chars: int, savings: dict):
        self.requests += 1
        self.total_original_chars += original_chars
        self.total_compressed_chars += compressed_chars
        self.total_compressions += savings.get("compressed", 0)

        for entry in savings.get("by_tool", []):
            name = entry["tool"]
            if name not in self.by_tool:
                self.by_tool[name] = {"count": 0, "saved_chars": 0, "original_chars": 0}
            self.by_tool[name]["count"] += 1
            self.by_tool[name]["saved_chars"] += entry["saved_chars"]
            self.by_tool[name]["original_chars"] += entry["original_chars"]

        saved = savings.get("saved_chars", 0)
        if saved > 0:
            original = savings.get("original_chars", 1)
            pct = round((saved / max(original, 1)) * 100)
            blocks = savings["compressed"]
            tokens = round(chars_to_tokens(saved))
            print(f"[squeezr] {blocks} block(s) compressed | -{saved:,} chars (~{tokens:,} tokens) ({pct}% saved)")

        self._persist()

    def summary(self) -> dict:
        total_saved = self.total_original_chars - self.total_compressed_chars
        pct = round((total_saved / max(self.total_original_chars, 1)) * 100, 1)
        by_tool_out = {}
        for tool, data in self.by_tool.items():
            tool_pct = round((data["saved_chars"] / max(data["original_chars"], 1)) * 100, 1)
            by_tool_out[tool] = {
                "count": data["count"],
                "saved_chars": data["saved_chars"],
                "saved_tokens": round(chars_to_tokens(data["saved_chars"])),
                "avg_pct": tool_pct,
            }
        return {
            "requests": self.requests,
            "compressions": self.total_compressions,
            "total_original_chars": self.total_original_chars,
            "total_saved_chars": total_saved,
            "total_saved_tokens": round(chars_to_tokens(total_saved)),
            "savings_pct": pct,
            "uptime_seconds": round(time.time() - self.session_start),
            "by_tool": by_tool_out,
        }

    def _persist(self):
        try:
            STATS_FILE.parent.mkdir(parents=True, exist_ok=True)
            existing = {}
            if STATS_FILE.exists():
                existing = json.loads(STATS_FILE.read_text())
            existing["requests"] = existing.get("requests", 0) + 1
            existing["total_original_chars"] = existing.get("total_original_chars", 0) + (
                self.total_original_chars
            )
            existing["total_saved_chars"] = existing.get("total_saved_chars", 0) + (
                self.total_original_chars - self.total_compressed_chars
            )
            by_tool = existing.get("by_tool", {})
            for tool, data in self.by_tool.items():
                if tool not in by_tool:
                    by_tool[tool] = {"count": 0, "saved_chars": 0, "original_chars": 0}
                by_tool[tool]["count"] = data["count"]
                by_tool[tool]["saved_chars"] = data["saved_chars"]
                by_tool[tool]["original_chars"] = data["original_chars"]
            existing["by_tool"] = by_tool
            STATS_FILE.write_text(json.dumps(existing, indent=2))
        except Exception:
            pass

    @classmethod
    def load_global(cls) -> dict:
        if not STATS_FILE.exists():
            return {}
        try:
            return json.loads(STATS_FILE.read_text())
        except Exception:
            return {}


def print_banner(port: int):
    print("=" * 52)
    print("  Squeezr v0.5.0 - Claude Context Compressor")
    print("  github.com/sergioramosv/Squeezr")
    print("=" * 52)
    print(f"  Running on: http://localhost:{port}")
    print(f"  Set env:    ANTHROPIC_BASE_URL=http://localhost:{port}")
    print("=" * 52)
    print()
