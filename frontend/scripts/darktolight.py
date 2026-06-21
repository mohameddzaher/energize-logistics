#!/usr/bin/env python3
"""Flip the ERP portal (/system) from a hardcoded dark theme to a clean light theme.

Deterministic, context-aware:
  - Context-free tokens (surfaces, borders, muted text, gradients) -> simple word-boundary remap.
  - text-white / hover:text-white -> evaluated PER quoted string segment so a ternary branch
    like 'bg-[#f37121] text-white' keeps white (text sits on a coloured surface) while a plain
    'text-white' on a card/grey surface becomes a dark text colour.
Modal backdrops (bg-black/*) are intentionally left dark.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent  # frontend/
TARGET_DIRS = [
    ROOT / "src/app/system",
    ROOT / "src/components/system",
    ROOT / "src/components/crm",
    ROOT / "src/components/hr",
]

# --- context-free token map (exact tailwind tokens) ---------------------------
CTX_FREE = {
    # solid surfaces
    "bg-gray-900": "bg-gray-50",
    "bg-gray-800": "bg-white",
    "bg-gray-750": "bg-gray-100",
    "bg-gray-700": "bg-gray-100",
    "bg-gray-600": "bg-gray-200",
    "bg-gray-500": "bg-gray-300",
    "bg-gray-400": "bg-gray-300",
    # translucent panels (NOT bg-black/* which are modal backdrops)
    "bg-gray-900/70": "bg-gray-100", "bg-gray-900/60": "bg-gray-100",
    "bg-gray-900/50": "bg-gray-100", "bg-gray-900/40": "bg-gray-100",
    "bg-gray-800/60": "bg-gray-50",  "bg-gray-800/50": "bg-gray-50",
    "bg-gray-800/40": "bg-gray-50",
    "bg-gray-700/50": "bg-gray-100", "bg-gray-700/40": "bg-gray-100",
    "bg-gray-700/30": "bg-gray-100", "bg-gray-700/20": "bg-gray-100",
    # hover surfaces
    "hover:bg-gray-900/30": "hover:bg-gray-100", "hover:bg-gray-900": "hover:bg-gray-100",
    "hover:bg-gray-800/80": "hover:bg-gray-50", "hover:bg-gray-800/50": "hover:bg-gray-50",
    "hover:bg-gray-800": "hover:bg-gray-50",
    "hover:bg-gray-700/70": "hover:bg-gray-100", "hover:bg-gray-700/50": "hover:bg-gray-100",
    "hover:bg-gray-700/40": "hover:bg-gray-100", "hover:bg-gray-700/30": "hover:bg-gray-100",
    "hover:bg-gray-700/20": "hover:bg-gray-100", "hover:bg-gray-700": "hover:bg-gray-100",
    "hover:bg-gray-600": "hover:bg-gray-200",
    # muted text
    "text-gray-100": "text-gray-900",
    "text-gray-200": "text-gray-800",
    "text-gray-300": "text-gray-700",
    "text-gray-400": "text-gray-500",
    # borders / dividers
    "border-gray-800": "border-gray-200",
    "border-gray-700/50": "border-gray-200/70",
    "border-gray-700/40": "border-gray-200/70",
    "border-gray-700": "border-gray-200",
    "border-gray-600/50": "border-gray-300/60",
    "border-gray-600": "border-gray-300",
    "border-gray-500": "border-gray-300",
    "divide-gray-800": "divide-gray-200",
    "divide-gray-700": "divide-gray-200",
    # variant-prefixed border / muted-text (boundary excludes ':' so list them whole)
    "hover:border-gray-600": "hover:border-gray-300",
    "hover:border-gray-700": "hover:border-gray-300",
    "focus:border-gray-600": "focus:border-gray-300",
    "focus:border-gray-700": "focus:border-gray-300",
    "hover:text-gray-300": "hover:text-gray-700",
    "hover:text-gray-400": "hover:text-gray-600",
    "hover:text-gray-200": "hover:text-gray-800",
    # grey gradients (login / headers) -> soft light gradient
    "from-gray-900": "from-gray-100", "via-gray-900": "via-white", "to-gray-900": "to-gray-100",
    "from-gray-800": "from-gray-100", "via-gray-800": "via-white", "to-gray-800": "to-gray-100",
}
# Apply longest tokens first so "bg-gray-900/50" wins over "bg-gray-900".
CTX_FREE_ITEMS = sorted(CTX_FREE.items(), key=lambda kv: -len(kv[0]))

def ctx_free_replace(text: str) -> str:
    for src, dst in CTX_FREE_ITEMS:
        # token boundary: not preceded by [\w:/-] and not followed by [\w/-]
        pat = re.compile(r"(?<![\w/:-])" + re.escape(src) + r"(?![\w/-])")
        text = pat.sub(dst, text)
    return text

# --- conditional text-white ---------------------------------------------------
# A segment "has a coloured surface" if it carries a non-grey background/gradient.
COLOURED = re.compile(
    r"bg-\[#|bg-gradient|bg-black"
    r"|(?:bg|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-"
    r"|from-\[#|to-\[#|via-\[#"
)
SEGMENT = re.compile(r"\"[^\"]*\"|'[^']*'")

def fix_white_in_segment(seg: str) -> str:
    if "text-white" not in seg:
        return seg
    if COLOURED.search(seg):
        return seg  # text sits on a coloured surface -> keep it white
    seg = re.sub(r"(?<![\w/:-])hover:text-white(?![\w/-])", "hover:text-gray-900", seg)
    seg = re.sub(r"(?<![\w/:-])text-white(?![\w/-])", "text-gray-900", seg)
    return seg

def process(text: str) -> str:
    text = ctx_free_replace(text)
    # Quote pairing is reset per line: a className's ternary branches each sit on
    # their own line, so per-line segments give correct context and avoid the
    # cross-file quote desync that a whole-file scan suffers from.
    lines = text.split("\n")
    for i, line in enumerate(lines):
        lines[i] = SEGMENT.sub(lambda m: fix_white_in_segment(m.group(0)), line)
    return "\n".join(lines)

def main():
    files = []
    for d in TARGET_DIRS:
        if d.exists():
            files += list(d.rglob("*.tsx")) + list(d.rglob("*.jsx"))
    changed = 0
    for f in files:
        original = f.read_text()
        updated = process(original)
        if updated != original:
            f.write_text(updated)
            changed += 1
    print(f"processed {len(files)} files, changed {changed}")

if __name__ == "__main__":
    main()
