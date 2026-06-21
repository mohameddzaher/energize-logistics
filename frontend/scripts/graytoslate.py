#!/usr/bin/env python3
"""Unify the ERP light theme on the cool SLATE family (premium, easier on the eye)
instead of neutral gray. Swaps gray-<n> -> slate-<n> for colour utilities only,
preserving any /opacity suffix and any variant prefix (hover:, focus:, ...).
bg-white, bg-black and all branded/status colours are untouched.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ["src/app/system", "src/components/system", "src/components/crm", "src/components/hr"]

PREFIXES = ["bg", "text", "border", "divide", "ring", "ring-offset",
            "from", "via", "to", "placeholder", "fill", "stroke", "outline", "accent"]

# (?<![\w-]) lets a ':' variant prefix sit right before (hover:bg-gray-100) while
# refusing to match inside a longer word. The /opacity suffix is left in place.
PAT = re.compile(r"(?<![\w-])(" + "|".join(PREFIXES) + r")-gray-(\d{1,3})")

def main():
    n = 0
    for d in DIRS:
        for f in (ROOT / d).rglob("*.tsx"):
            t = f.read_text()
            nt = PAT.sub(r"\1-slate-\2", t)
            if nt != t:
                f.write_text(nt); n += 1
    print("files updated:", n)

if __name__ == "__main__":
    main()
