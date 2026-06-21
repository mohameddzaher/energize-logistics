#!/usr/bin/env python3
"""Apply the dark-header principle to the whole system (not just tables):

1) Modal headers (discrete `px-6 py-4 border-b ... flex justify-between` bar with
   overflow-hidden parent) -> full-width dark slate-900 strip, white title, light close.
2) Every card/section title (h2/h3 with text-slate-900 + font-semibold/bold) -> a dark
   inset header bar (bg-slate-900 white text, rounded), uniform across all cards regardless
   of padding/position. Page <h1> titles are left alone.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ["src/app/system", "src/components/system", "src/components/crm", "src/components/hr"]

# ---- 1) modal header bars -------------------------------------------------
MODAL_HEADER = re.compile(
    r'<div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">[\s\S]*?</div>'
)

def fix_modal(block: str) -> str:
    b = block.replace('px-6 py-4 border-b border-slate-200 flex items-center justify-between',
                      'px-6 py-4 bg-slate-900 flex items-center justify-between')
    b = b.replace('text-slate-900', 'text-white')
    b = b.replace('hover:text-slate-900', 'hover:text-white')
    b = b.replace('text-slate-500', 'text-slate-300')
    return b

# ---- 2) card / section title bars ----------------------------------------
TITLE = re.compile(r'<h([23]) className="([^"]*)">')

def fix_title(m: re.Match) -> str:
    tag, cls = m.group(1), m.group(2)
    if 'text-slate-900' not in cls:
        return m.group(0)
    if 'font-semibold' not in cls and 'font-bold' not in cls:
        return m.group(0)
    if 'bg-slate-900' in cls:
        return m.group(0)
    new = cls.replace('text-slate-900', 'text-white')
    if 'mb-' not in new:
        new = new + ' mb-3'
    new = 'bg-slate-900 px-3 py-2 rounded-lg ' + new
    return f'<h{tag} className="{new}">'

def main():
    n = 0
    for d in DIRS:
        for f in (ROOT / d).rglob("*.tsx"):
            t = f.read_text()
            nt = MODAL_HEADER.sub(lambda m: fix_modal(m.group(0)), t)
            nt = TITLE.sub(fix_title, nt)
            if nt != t:
                f.write_text(nt); n += 1
    print("files updated:", n)

if __name__ == "__main__":
    main()
