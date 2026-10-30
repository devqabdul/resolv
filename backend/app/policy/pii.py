import re

# Order matters: specific shapes first so the generic account-number pattern
# does not swallow cards, Aadhaar or phones, and email before VPA.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("upi_vpa", re.compile(r"\b([\w.-])[\w.-]*@([a-zA-Z]{2,})\b")),
    ("pan", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("card_number", re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b")),
    ("aadhaar", re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}\b")),
    ("phone", re.compile(r"(?:\+91[ -]?|\b0?)[6-9]\d{4}[ -]?\d{5}\b")),
    ("account_number", re.compile(r"\b\d{9,18}\b")),
]


def _vpa(m: re.Match[str]) -> str:
    return f"{m.group(1)}***@{m.group(2)}"


def mask(text: str) -> tuple[str, list[str]]:
    """Mask the 7 PII classes in rules.yaml `pii.mask`; returns (masked_text, classes_found)."""
    found: list[str] = []
    for name, pattern in _PATTERNS:
        repl = _vpa if name == "upi_vpa" else f"[{name.upper()}]"
        text, n = pattern.subn(repl, text)
        if n:
            found.append(name)
    return text, found
