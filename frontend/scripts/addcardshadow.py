#!/usr/bin/env python3
"""Add a subtle shadow to card-like surfaces so white cards lift off the grey page.

A "card" = a className segment that has bg-white + rounded-xl/2xl + border-gray-200
and no existing shadow utility. Buttons (rounded-lg) and badges (rounded-full) are
left untouched.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ["src/app/system", "src/components/system", "src/components/crm", "src/components/hr"]
SEG = re.compile(r"\"[^\"]*\"|'[^']*'|`[^`]*`")

def is_card(body: str) -> bool:
    return ("bg-white" in body
            and re.search(r"rounded-(xl|2xl)", body)
            and "border-gray-200" in body
            and "shadow" not in body)

def fix_seg(seg: str) -> str:
    q = seg[0]
    body = seg[1:-1]
    if is_card(body):
        return q + body.rstrip() + " shadow-sm" + q
    return seg

def main():
    n = 0
    for d in DIRS:
        for f in (ROOT / d).rglob("*.tsx"):
            t = f.read_text()
            lines = t.split("\n")
            for i, l in enumerate(lines):
                lines[i] = SEG.sub(lambda m: fix_seg(m.group(0)), l)
            nt = "\n".join(lines)
            if nt != t:
                f.write_text(nt); n += 1
    print("files updated:", n)

if __name__ == "__main__":
    main()
