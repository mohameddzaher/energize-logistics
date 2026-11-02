'use client';
/**
 * Date inputs read correctly for everyone. An empty date input writes its format from the OS locale and Chrome forces ltr, so CSS and `lang` cannot fix it (see styles/globals.css).
 * Sets data-empty="1" on empty inputs so CSS paints dd/mm/yyyy instead, and opens the picker on a click anywhere via showPicker().
 * A DOM observer is used because ~200 inputs sit in ~87 files, many inside modals built on open.
 */
import { useEffect } from 'react';

// `time` is excluded: its order does not vary by locale like dates do.
const TYPES = ['date', 'datetime-local', 'month', 'week'];
const SELECTOR = TYPES.map((t) => `input[type="${t}"]`).join(',');

function mark(el: Element) {
  const input = el as HTMLInputElement;
  if (input.value) input.removeAttribute('data-empty');
  else input.setAttribute('data-empty', '1');
}

function markAll(root: ParentNode) {
  root.querySelectorAll?.(SELECTOR).forEach(mark);
}

export default function DateFieldLocale() {
  useEffect(() => {
    markAll(document);

    // Inputs are filled and emptied after render, possibly from code; both events are caught in the capture phase so ones inside modals are seen too.
    const onChange = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.matches?.(SELECTOR)) mark(t);
    };
    document.addEventListener('input', onChange, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('blur', onChange, true);

    // A click anywhere in the field opens the native picker; browsers without `showPicker` are left as they are, no error.
    const onClick = (e: Event) => {
      const t = e.target as (HTMLInputElement & { showPicker?: () => void }) | null;
      if (!t?.matches?.(SELECTOR) || t.disabled || t.readOnly) return;
      try { t.showPicker?.(); } catch { /* Some of them need direct interaction. */ }
    };
    document.addEventListener('click', onClick, true);

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const el = n as Element;
          if (el.matches?.(SELECTOR)) mark(el);
          markAll(el);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('input', onChange, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('blur', onChange, true);
      document.removeEventListener('click', onClick, true);
      mo.disconnect();
    };
  }, []);
  return null;
}
