import os


class Config:
    def __init__(self):
        self.threshold = int(os.environ.get("SQUEEZR_THRESHOLD", "800"))
        self.keep_recent = int(os.environ.get("SQUEEZR_KEEP_RECENT", "3"))
        self.port = int(os.environ.get("SQUEEZR_PORT", "8080"))
        self.disabled = os.environ.get("SQUEEZR_DISABLED", "").lower() in ("1", "true")
