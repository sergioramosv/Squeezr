import time
from dataclasses import dataclass, field


@dataclass
class Stats:
    requests: int = 0
    total_original_chars: int = 0
    total_compressed_chars: int = 0
    total_compressions: int = 0
    session_start: float = field(default_factory=time.time)

    def record(self, original_chars: int, compressed_chars: int, savings: dict):
        self.requests += 1
        self.total_original_chars += original_chars
        self.total_compressed_chars += compressed_chars
        self.total_compressions += savings.get("compressed", 0)

        saved = savings.get("saved_chars", 0)
        if saved > 0:
            original = savings.get("original_chars", 1)
            pct = round((saved / max(original, 1)) * 100)
            blocks = savings["compressed"]
            print(f"[squeezr] {blocks} block(s) compressed | -{saved:,} chars ({pct}% saved this request)")

    def summary(self) -> dict:
        total_saved = self.total_original_chars - self.total_compressed_chars
        pct = round((total_saved / max(self.total_original_chars, 1)) * 100, 1)
        return {
            "requests": self.requests,
            "compressions": self.total_compressions,
            "total_saved_chars": total_saved,
            "savings_pct": pct,
            "uptime_seconds": round(time.time() - self.session_start),
        }


def print_banner(port: int):
    print("=" * 52)
    print("  Squeezr v0.1.0 - Claude Context Compressor")
    print("  github.com/sergioramosv/Squeezr")
    print("=" * 52)
    print(f"  Running on: http://localhost:{port}")
    print(f"  Set env:    ANTHROPIC_BASE_URL=http://localhost:{port}")
    print("=" * 52)
    print()
