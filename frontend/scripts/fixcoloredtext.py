#!/usr/bin/env python3
"""Darken semantic status text colours for the light theme.

text-<hue>-300/400 were tuned for a dark background and are too low-contrast on
white. Map them to 600/700 (lighter hues like yellow/amber go darker). Tinted
badge backgrounds (bg-*-500/10, /20) stay — they read as soft pastel chips on white.
Works on prefixed variants too (hover:, group-hover:) since the lookbehind allows ':'.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ["src/app/system", "src/components/system", "src/components/crm", "src/components/hr"]

LIGHT_HUES = ["yellow", "amber", "lime", "cyan", "sky", "teal"]
OTHER_HUES = ["red", "green", "emerald", "blue", "indigo", "violet",
              "purple", "orange", "rose", "pink", "fuchsia"]

mapping = {}
for h in LIGHT_HUES:
    mapping[f"text-{h}-400"] = f"text-{h}-700"
    mapping[f"text-{h}-300"] = f"text-{h}-700"
for h in OTHER_HUES:
    mapping[f"text-{h}-400"] = f"text-{h}-600"
    mapping[f"text-{h}-300"] = f"text-{h}-700"

def process(t: str) -> str:
    for src, dst in mapping.items():
        t = re.sub(r"(?<![\w-])" + re.escape(src) + r"(?!\d)", dst, t)
    return t

def main():
    n = 0
    for d in DIRS:
        for f in (ROOT / d).rglob("*.tsx"):
            t = f.read_text()
            nt = process(t)
            if nt != t:
                f.write_text(nt); n += 1
    print("files updated:", n)

if __name__ == "__main__":
    main()
