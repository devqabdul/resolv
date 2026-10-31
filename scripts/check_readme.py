#!/usr/bin/env python3
"""Check README.md has the required sections and tokens (R26). stdlib only. (decision: T27)

Usage: python3 scripts/check_readme.py [--self-test]. Exit 1 if anything is missing.
"""
import re
import sys
from pathlib import Path

# heading -> list of alternatives groups; each group needs at least one of its tokens
REQUIRED = {
    "Quick start": [["make dev"], ["make seed"], ["localhost:3000/?demo=1"]],
    "LLM modes": [["`mock`"], ["`replay`"], ["`live`"], ["LLM_MODE"]],
    "Warm the replay cache (attended)": [["make warm", "warm_cache.sh"]],
    "Tests and evals": [["make test"], ["make evals"]],
}


def check(text: str) -> list[str]:
    """Return the list of MISSING messages (empty = good); prints one line per check."""
    sections = {m.group(1).strip(): m.end() for m in re.finditer(r"^## (.+)$", text, re.M)}
    heads = sorted(sections.values())
    missing = []
    for name, groups in REQUIRED.items():
        if name not in sections:
            line = f"MISSING: section '## {name}'"
            print(line)
            missing.append(line)
            continue
        start = sections[name]
        end = next((h for h in heads if h > start), len(text))
        # ponytail: body ends at the next "## " heading start; heading text is included, harmless
        body = text[start:end]
        print(f"OK: section '## {name}'")
        for alts in groups:
            label = " or ".join(alts)
            if any(t in body for t in alts):
                print(f"OK: '{name}' has {label}")
            else:
                line = f"MISSING: '{name}' lacks {label}"
                print(line)
                missing.append(line)
    return missing


def self_test() -> int:
    good = "\n".join(
        f"## {n}\n" + " ".join(g[0] for g in gs) + "\n" for n, gs in REQUIRED.items()
    )
    assert check(good) == [], "good README must pass"
    assert check(good.replace("make seed", "x")), "missing token must fail"
    assert check(good.replace("## Tests and evals", "## Other")), "missing section must fail"
    print("self-test OK")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    readme = Path(__file__).resolve().parents[1] / "README.md"
    return 1 if check(readme.read_text(encoding="utf-8")) else 0


if __name__ == "__main__":
    sys.exit(main())
