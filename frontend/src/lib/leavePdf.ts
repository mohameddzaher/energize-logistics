// The official leave sheet is built on the server (backend services/leaveSheet), so web and mobile download the same file and signatures are read at print time.
import api from './api';

export async function downloadLeaveSheet(leaveId: string, fileHint = '') {
  const blob = await api.getBlob(`/api/hr/leaves/${leaveId}/sheet.pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leave-${(fileHint || leaveId).replace(/\s+/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Shows the sheet exactly as it will print (same server file, signatures included) in a window over the page,
 * with a download button. Plain DOM so every screen gets it with one call and no state of its own.
 */
export async function previewLeaveSheet(leaveId: string, ar = true, fileHint = '') {
  const blob = await api.getBlob(`/api/hr/leaves/${leaveId}/sheet.pdf`);
  const url = URL.createObjectURL(blob);
  const wrap = document.createElement('div');
  wrap.setAttribute('dir', ar ? 'rtl' : 'ltr');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;width:min(900px,100%);height:min(92vh,1100px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25)';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e2e8f0;font:600 14px Tahoma,Arial,sans-serif;color:#0f172a';
  const title = document.createElement('span');
  title.textContent = ar ? 'معاينة ورقة الإجازة' : 'Leave sheet preview';
  title.style.flex = '1';
  const dl = document.createElement('a');
  dl.href = url;
  dl.download = `leave-${(fileHint || leaveId).replace(/\s+/g, '_')}.pdf`;
  dl.textContent = ar ? 'تحميل' : 'Download';
  dl.style.cssText = 'background:#f37121;color:#fff;border-radius:8px;padding:6px 14px;text-decoration:none;font-size:13px';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = ar ? 'إغلاق' : 'Close';
  close.style.cssText = 'background:#f1f5f9;color:#334155;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px';
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = title.textContent;
  frame.style.cssText = 'flex:1;border:0;width:100%';
  const done = () => { wrap.remove(); document.removeEventListener('keydown', onKey); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
  close.onclick = done;
  wrap.onclick = (e) => { if (e.target === wrap) done(); };
  document.addEventListener('keydown', onKey);
  bar.append(title, dl, close);
  box.append(bar, frame);
  wrap.append(box);
  document.body.append(wrap);
}
