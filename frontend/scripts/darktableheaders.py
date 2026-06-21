#!/usr/bin/env python3
"""Make every data-table header dark + clear, matching the shared DataTable look
(slate-900 row, light semibold text). Only touches content INSIDE <thead>...</thead>
so body rows / summary rows stay white.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ["src/app/system", "src/components/system", "src/components/crm", "src/components/hr"]
THEAD = re.compile(r"<thead\b[\s\S]*?</thead>")

def fix_thead(block: str) -> str:
    b = block
    # light header text -> bright; medium weight -> semibold
    for a, c in [
        ("text-slate-400", "text-slate-300"),
        ("text-slate-500", "text-slate-300"),
        ("text-slate-600", "text-slate-300"),
        ("text-slate-700", "text-slate-200"),
        ("font-medium", "font-semibold"),
        # any existing light header bg -> dark
        ("bg-slate-50", "bg-slate-900"),
        ("bg-slate-100", "bg-slate-900"),
        ("bg-white", "bg-slate-900"),
    ]:
        b = b.replace(a, c)
    # ensure the header row actually carries the dark bg
    if "bg-slate-900" not in b:
        def addbg(m):
            tag = m.group(0)
            if 'className="' in tag:
                return tag.replace('className="', 'className="bg-slate-900 ', 1)
            return tag[:-1] + ' className="bg-slate-900">'
        nb = re.sub(r"<tr\b[^>]*>", addbg, b, count=1)
        if nb == b:  # no <tr> (headers directly under thead) -> put bg on thead
            nb = re.sub(r"<thead\b[^>]*>", addbg, b, count=1)
        b = nb
    return b

def main():
    n = 0
    for d in DIRS:
        for f in (ROOT / d).rglob("*.tsx"):
            t = f.read_text()
            nt = THEAD.sub(lambda m: fix_thead(m.group(0)), t)
            if nt != t:
                f.write_text(nt); n += 1
    print("files updated:", n)

if __name__ == "__main__":
    main()
