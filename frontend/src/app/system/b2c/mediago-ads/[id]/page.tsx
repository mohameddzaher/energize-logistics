'use client';
/**
 * طلبُ محتوًى إعلانيّ — صفحتُه (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢: «يفتحلي صفحته مش بوب اب»).
 *
 * البطاقاتُ أوّلًا، ثمّ المركباتُ وتحقّقُها، ثمّ الملاحظاتُ والمسار. ونوعُ المحتوى
 * هو ما طلبه Media Go — صورٌ فقط أو فيديو فقط، لا يُبدَّل لمركبة — ونصوّره حيًّا
 * من الكاميرا (LiveCamera) أو نرفعه من الجهاز. والعارضُ فوق الصفحة: إغلاقُه لا
 * يُغلق شيئًا غيرَه.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Spinner } from '@/components/hr/HRKit';
import { Camera, Video, Check, Loader2, Trash2, Send, Car, CheckCircle2, RotateCcw, Ban, Lock, ArrowRight, Upload } from 'lucide-react';
import {
  API, MAX_VIDEO_SEC, STATUS_TONE, fmtDate, fmtDT, readFile, videoDuration, Lightbox, Thumbs, LiveCamera,
  type Meta, type Can, type AdFile, type AdItem, type Full, type Shot,
} from '@/components/b2c/MediaGoAdKit';

export default function AdRequestPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify, confirm, prompt } = useDialog();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const onClose = useCallback(() => router.push('/system/b2c/mediago-ads'), [router]);
  const onChanged = () => {};
  const t = (a: string, e: string) => (ar ? a : e);
  const [d, setD] = useState<Full | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [can, setCan] = useState<Can | null>(null);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<{ files: AdFile[]; i: number } | null>(null);
  const [reply, setReply] = useState('');
  const [cam, setCam] = useState<{ url: string; key: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const load = useCallback(async () => {
    try { const r = await api.get<{ item: Full; meta: Meta; can: Can }>(`${API}/${id}`); setD(r.item); setMeta(r.meta); setCan(r.can); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); onClose(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('mediago:ad', useCallback((p: any) => { if (!p?.id || p.id === id) { if (p?.action === 'deleted') onClose(); else load(); } }, [id, load, onClose]));
  const after = (item: Full) => { setD(item); onChanged(); };
  const V = (g: 'mediaType' | 'location' | 'status', k: string) => { const x = meta?.[g].find((v) => v.key === k); return x ? (ar ? x.ar : x.en) : k; };
  const editable = !!d && ['new', 'in_progress'].includes(d.status);

  const send = async (url: string, files: Shot[], key: string) => {
    if (!files.length) return;
    setBusy(key);
    try { after((await api.post<{ item: Full }>(url, { files })).item); notify(t(`حُفِظ ${files.length}`, `Saved ${files.length}`), 'success'); }
    catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy('');
  };
  const upload = async (url: string, list: FileList | null, want: 'photo' | 'video', key: string) => {
    if (!list || !list.length) return;
    const files: Shot[] = [];
    for (const file of Array.from(list)) {
      const isVid = file.type.startsWith('video/');
      if (want === 'photo' && isVid) { notify(t('الطلب صور — الفيديو غير مسموح', 'This request is photos only'), 'error'); return; }
      if (want === 'video' && !isVid) { notify(t('الطلب فيديو — الصور غير مسموحة', 'This request is video only'), 'error'); return; }
      let durationSec: number | undefined;
      if (isVid) {
        durationSec = await videoDuration(file);
        if (durationSec > MAX_VIDEO_SEC + 0.5) { notify(t(`المقطع ${Math.round(durationSec)} ثانية — الحدّ ${MAX_VIDEO_SEC} ثانية`, `Video is ${Math.round(durationSec)}s — max ${MAX_VIDEO_SEC}s`), 'error'); return; }
        if (file.size > 15 * 1024 * 1024) { notify(t('المقطع أكبر من 15 ميغا', 'Video over 15 MB'), 'error'); return; }
      } else if (file.size > 8 * 1024 * 1024) { notify(t('الصورة أكبر من 8 ميغا', 'Image over 8 MB'), 'error'); return; }
      files.push({ dataUrl: await readFile(file), fileName: file.name, durationSec });
    }
    await send(url, files, key);
  };
  const removeFile = async (url: string) => {
    if (!(await confirm({ message: t('حذف هذا الملف؟', 'Delete this file?'), tone: 'danger', confirmLabel: t('حذف', 'Delete') }))) return;
    try { after((await api.delete<{ item: Full }>(url)).item); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };
  const patchItem = async (it: AdItem, body: any) => {
    setBusy(`i:${it._id}`);
    try { after((await api.patch<{ item: Full }>(`${API}/${id}/items/${it._id}`, body)).item); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const deliver = async () => {
    const note = await prompt({ title: t('تمّ — إرسال المحتوى إلى Media Go', 'Done — send to Media Go'), message: t('ملاحظة مع التسليم (اختياري)', 'A note with the delivery (optional)'), confirmLabel: t('إرسال', 'Send') });
    if (note === null) return;
    setBusy('deliver');
    try { after((await api.post<{ item: Full }>(`${API}/${id}/deliver`, { note })).item); notify(t('وصل المحتوى إلى Media Go', 'Delivered to Media Go'), 'success'); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const setStatus = async (status: string, needNote: boolean) => {
    const note = needNote ? await prompt({ title: V('status', status), message: t('السبب', 'Reason'), confirmLabel: t('تأكيد', 'Confirm') }) : '';
    if (note === null || (needNote && !String(note).trim())) return;
    setBusy(`s:${status}`);
    try { after((await api.patch<{ item: Full }>(`${API}/${id}/status`, { status, note })).item); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy('reply');
    try { after((await api.post<{ item: Full }>(`${API}/${id}/replies`, { text: reply.trim() })).item); setReply(''); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const remove = async () => {
    if (!(await confirm({ message: t('حذف الطلب نهائيًّا مع ملفّاته؟', 'Delete the request and its files permanently?'), tone: 'danger', confirmLabel: t('حذف', 'Delete') }))) return;
    try { await api.delete(`${API}/${id}`); onChanged(); onClose(); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  const allReady = !!d && (d.items.length ? d.items.every((i) => i.ready) : d.files.length > 0);
  return (
    <div className="mx-auto max-w-7xl space-y-4" dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-white">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-white/20">
            <ArrowRight className="h-4 w-4 ltr:rotate-180" />{t('كل الطلبات', 'All requests')}
          </button>
          {/* على الهاتف: العنوانُ سطرٌ كاملٌ تحت الأزرار — لا عمودٌ ضيّقٌ بينها. */}
          <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
            <p className="text-[12px] text-slate-400">{d ? `${fmtDT(d.createdAt)} · ${d.createdByName}` : ''}</p>
            <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-[19px] font-extrabold">
              <span>{d?.adName || '…'}</span><span dir="ltr" className="text-[13px] font-semibold text-slate-400">{d?.ref}</span>
              {d && <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${STATUS_TONE[d.status] || ''}`}>{V('status', d.status)}</span>}
            </h2>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            {d && can?.deliver && editable && (
              <button type="button" onClick={deliver} disabled={!allReady || busy === 'deliver'} title={!allReady ? t('راجع كل المركبات وعلّمها «جاهزة» أوّلًا', 'Mark every vehicle ready first') : ''}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-bold hover:bg-emerald-700 disabled:opacity-40">
                {busy === 'deliver' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{t('تمّ — إرسال إلى Media Go', 'Done — send to Media Go')}
              </button>
            )}
            {d && can?.close && d.status === 'delivered' && <button type="button" onClick={() => setStatus('closed', false)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-white/20"><Lock className="h-3.5 w-3.5" />{t('إغلاق', 'Close')}</button>}
            {d && can?.close && ['delivered', 'closed'].includes(d.status) && <button type="button" onClick={() => setStatus('in_progress', true)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-white/20"><RotateCcw className="h-3.5 w-3.5" />{t('إعادة فتح', 'Reopen')}</button>}
            {d && can?.cancel && editable && <button type="button" onClick={() => setStatus('cancelled', false)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-red-200 hover:bg-red-500/80 hover:text-white"><Ban className="h-3.5 w-3.5" />{t('إلغاء الطلب', 'Cancel request')}</button>}
            {d && can?.delete && <button type="button" onClick={remove} className="rounded-lg p-1.5 text-slate-300 hover:bg-red-500/80 hover:text-white" title={t('حذف', 'Delete')}><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
        {!d ? <Spinner /> : (
          <div className="space-y-4">
            {/* البطاقاتُ أوّلًا */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
              {[
                [t('الشركة', 'Company'), d.company], [t('المطلوب', 'Needed'), V('mediaType', d.mediaType)], [t('المكان', 'Where'), V('location', d.location)],
                [t('التاريخ', 'Date'), d.neededBy ? d.neededBy.split('-').reverse().join('/') : '—'],
                [t('المركبات', 'Vehicles'), d.items.length ? `${d.items.filter((i) => i.ready).length}/${d.items.length} ${t('جاهزة', 'ready')}` : '—'],
                [t('سُلِّم', 'Delivered'), d.deliveredAt ? fmtDate(d.deliveredAt) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11.5px] font-semibold text-slate-500">{k}</p><p className="mt-0.5 text-[13.5px] font-bold text-slate-900">{v}</p></div>
              ))}
            </div>
            {d.note && <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700"><b>{t('ملاحظة الطلب', 'Request note')}:</b> {d.note}</p>}

            {/* المركباتُ وتحقّقُها */}
            {d.items.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.items.map((it) => (
                  <div key={it._id} className={`rounded-xl border bg-white p-3 ${it.ready ? 'border-emerald-300' : 'border-slate-200'}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold text-slate-900"><Car className="me-1 inline h-4 w-4 text-slate-400" />{it.plateNumber || '—'}</p>
                        <p className="text-[11.5px] text-slate-500">{[it.serialNumber && `#${it.serialNumber}`, it.project].filter(Boolean).join(' · ')}</p>
                      </div>
                      {it.ready
                        ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />{t('جاهزة', 'Ready')}</span>
                        : <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-500">{it.files.length ? t('بانتظار المراجعة', 'To review') : t('لم تُصوَّر', 'Not shot')}</span>}
                    </div>
                    {it.files.length ? <Thumbs files={it.files} onOpen={(i) => setView({ files: it.files, i })} onRemove={can?.shoot && editable ? (f) => removeFile(`${API}/${id}/items/${it._id}/files/${f._id}`) : undefined} />
                      : <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-[12px] text-slate-400">{can?.partner ? t('لم يُصوَّر بعد', 'Not shot yet') : t('لا ملفات بعد', 'No files yet')}</p>}
                    {can?.shoot && editable && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <input ref={(el) => { inputs.current[it._id] = el; }} type="file" hidden multiple={d.mediaType === 'photo'}
                          accept={d.mediaType === 'video' ? 'video/*' : 'image/*'}
                          onChange={(e) => { upload(`${API}/${id}/items/${it._id}/files`, e.target.files, d.mediaType, `u:${it._id}`); e.target.value = ''; }} />
                        {shootButtons(busy === `u:${it._id}`, () => setCam({ url: `${API}/${id}/items/${it._id}/files`, key: `u:${it._id}` }), () => inputs.current[it._id]?.click())}
                        {!!it.files.length && (
                          <button type="button" onClick={() => patchItem(it, { ready: !it.ready })} disabled={busy === `i:${it._id}`}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold ${it.ready ? 'bg-slate-100 text-slate-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                            <Check className="h-3.5 w-3.5" />{it.ready ? t('إلغاء «جاهزة»', 'Unmark ready') : t('راجعتُها — جاهزة', 'Reviewed — ready')}
                          </button>
                        )}
                      </div>
                    )}
                    {it.ready && it.readyByName && <p className="mt-1.5 text-[11px] text-slate-400">{t('راجعها', 'Reviewed by')} {it.readyByName} · {fmtDT(it.readyAt)}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* طلبٌ بلا مركبات: ملفّاتُه */}
            {!d.items.length && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('المحتوى', 'Content')} ({d.files.length})</p>
                {d.files.length ? <Thumbs files={d.files} onOpen={(i) => setView({ files: d.files, i })} onRemove={can?.shoot && editable ? (f) => removeFile(`${API}/${id}/files/${f._id}`) : undefined} />
                  : <p className="py-4 text-center text-[12px] text-slate-400">{t('لا ملفات بعد', 'No files yet')}</p>}
                {can?.shoot && editable && (
                  <div className="mt-2">
                    <input ref={(el) => { inputs.current.req = el; }} type="file" hidden multiple={d.mediaType === 'photo'} accept={d.mediaType === 'video' ? 'video/*' : 'image/*'}
                      onChange={(e) => { upload(`${API}/${id}/files`, e.target.files, d.mediaType, 'u:req'); e.target.value = ''; }} />
                    <div className="flex flex-wrap gap-1.5">{shootButtons(busy === 'u:req', () => setCam({ url: `${API}/${id}/files`, key: 'u:req' }), () => inputs.current.req?.click())}</div>
                  </div>
                )}
              </div>
            )}

            {/* الملاحظاتُ والمسار */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-3">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('الملاحظات', 'Notes')} ({d.replies.length})</p>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {d.replies.map((r) => {
                    const mine = (r.side === 'mediago') === !!can?.partner;
                    return (
                      <div key={r._id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${r.side === 'mediago' ? 'bg-violet-50 ring-1 ring-violet-100' : 'bg-orange-50 ring-1 ring-orange-100'}`}>
                          <p className="text-[10.5px] font-bold text-slate-500">{r.side === 'mediago' ? 'Media Go' : 'Energize'}{r.byName ? ` · ${r.byName}` : ''}</p>
                          <p className="whitespace-pre-wrap text-[13px]" dir="auto">{r.text}</p>
                          <p className="text-[10px] text-slate-400">{fmtDT(r.at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {!d.replies.length && <p className="text-[12.5px] text-slate-400">{t('لا ملاحظات بعد', 'No notes yet')}</p>}
                </div>
                <div className="mt-2 flex items-end gap-2 border-t border-slate-100 pt-2">
                  <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} dir="auto" placeholder={t('اكتب ملاحظة…', 'Write a note…')}
                    className="min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                  <button type="button" onClick={sendReply} disabled={!reply.trim() || busy === 'reply'} className="inline-flex h-10 items-center rounded-xl bg-[#f37121] px-3 text-white disabled:opacity-50">
                    {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-2">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('مسار الطلب', 'Timeline')}</p>
                <ol className="space-y-2 border-s-2 border-slate-100 ps-3">
                  {d.statusHistory.map((h, i) => (
                    <li key={i}>
                      <p className="text-[12.5px] font-bold text-slate-800">{V('status', h.status)}</p>
                      <p className="text-[11px] text-slate-500">{h.side === 'mediago' ? 'Media Go' : 'Energize'}{h.byName ? ` · ${h.byName}` : ''} · {fmtDT(h.at)}</p>
                      {h.note && <p className="text-[12px] text-slate-600">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      {view && <Lightbox files={view.files} index={view.i} onClose={() => setView(null)} onIndex={(i) => setView((v) => (v ? { ...v, i } : v))} />}
      {cam && d && (
        <LiveCamera mode={d.mediaType} ar={ar} onClose={() => setCam(null)}
          onDone={(shots) => { const c = cam; setCam(null); send(c.url, shots, c.key); }} />
      )}
    </div>
  );

  // ── صوّر حيًّا أو ارفع — النوعُ هو نوعُ الطلب، لا غيرُه ──
  // دالّةٌ تُستدعى لا مكوّنٌ يُركَّب — فلا يُعاد تركيبُ ما حولها مع كلّ رسم.
  function shootButtons(on: boolean, onShoot: () => void, onPick: () => void) {
    const vid = d?.mediaType === 'video';
    return (
      <>
        <button type="button" onClick={onShoot} disabled={on}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-[12.5px] font-bold text-white hover:bg-[#d95f14] disabled:opacity-50">
          {on ? <Loader2 className="h-4 w-4 animate-spin" /> : vid ? <Video className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {vid ? t(`تصوير فيديو (≤${MAX_VIDEO_SEC} ث)`, `Record video (≤${MAX_VIDEO_SEC}s)`) : t('تصوير صور', 'Take photos')}
        </button>
        <button type="button" onClick={onPick} disabled={on}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121]/10 px-3 py-2 text-[12.5px] font-bold text-[#b4471a] hover:bg-[#f37121]/20 disabled:opacity-50">
          <Upload className="h-4 w-4" />{vid ? t('رفع فيديو من الجهاز', 'Upload a video') : t('رفع صور من الجهاز', 'Upload photos')}
        </button>
      </>
    );
  }
}

