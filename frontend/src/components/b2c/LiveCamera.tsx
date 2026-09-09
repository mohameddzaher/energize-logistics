'use client';
/**
 * كاميرا حيّة — لا زرَّ رفعٍ فيها بقصد.
 *
 * ── لماذا لا يُقبَل رفعُ ملفّ ─────────────────────────────────────────────
 * الصورةُ هي الحجّةُ كلُّها في تفقّد بداية الدوام: تُقارَن بما رجعت به المركبةُ
 * مساءً فيُعرَف أين وقع العطبُ ومَن يُسأل عنه. فإن جاز أن تُرفَع من ملفّات
 * الجهاز جاز أن تكون صورةَ أمسِ أو صورةَ درّاجةٍ أخرى، وصار السجلُّ ورقةً
 * تُملأ من المكتب — وهو عينُ ما وُجدت الشاشةُ لتمنعه.
 *
 * ولذلك لا `<input type="file">` هنا أصلًا، ولا حتّى بـ`capture` — فتلك تفتح
 * الكاميرا على الهاتف وتفتح متصفّحَ الملفّات على الحاسوب. وهذه تقرأ من
 * `getUserMedia` مباشرةً وترسم على `canvas`: لا سبيلَ إلى ملفٍّ من القرص.
 *
 * ── وما لا تدّعيه ────────────────────────────────────────────────────────
 * لا تمنع هذه الشاشةُ أن يُصوَّر أحدٌ شاشةً أخرى بالكاميرا. الحارسُ الحقيقيّ
 * أنّ المشرفَ يوقّع باسمه ويُسجَّل موضعُه ووقتُه — والصورةُ تجعل الكذبَ عملًا
 * لا سهوًا.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X, AlertTriangle, SwitchCamera } from 'lucide-react';

export interface Shot { dataUrl: string; fileName: string; captureSource: 'camera' }

export default function LiveCamera({
  onShot, disabled, ar, max = 3, shots, onRemove,
}: {
  onShot: (s: Shot) => void;
  onRemove: (i: number) => void;
  shots: Shot[];
  disabled?: boolean;
  ar: boolean;
  max?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  // الخلفيّةُ أوّلًا: هي التي تُصوَّر بها الدرّاجة، لا كاميرا الوجه.
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError('');
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(ar
        ? 'هذا المتصفّح لا يتيح الكاميرا. افتح الصفحة من تطبيق الجوّال أو من متصفّحٍ حديث على اتصالٍ آمن (https).'
        : 'This browser cannot open the camera. Use the mobile app or a modern browser over https.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (e: any) {
      // رفضُ الإذن ليس عطبًا — يُقال للمستخدم ما يفعله، لا اسمُ الاستثناء.
      const name = e?.name || '';
      setError(
        name === 'NotAllowedError'
          ? (ar ? 'رُفض إذن الكاميرا. اسمح به من إعدادات المتصفّح ثمّ أعد المحاولة.' : 'Camera permission denied. Allow it in the browser settings and retry.')
          : name === 'NotFoundError'
            ? (ar ? 'لا كاميرا في هذا الجهاز.' : 'No camera on this device.')
            : (ar ? 'تعذّر فتح الكاميرا.' : 'Could not open the camera.'),
      );
    }
  }, [facing, stop, ar]);

  useEffect(() => { start(); return stop; }, [start, stop]);

  const take = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    // يُصغَّر الطولُ الأكبرُ إلى 1280: صورةُ الهاتف الخام أربعةُ ميغابايت،
    // وعشرون مندوبًا كلَّ صباحٍ تملأ القرصَ بلا فائدةٍ في الوضوح.
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    onShot({
      dataUrl: c.toDataURL('image/jpeg', 0.82),
      fileName: `duty-${Date.now()}.jpg`,
      captureSource: 'camera',
    });
  };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-slate-900 aspect-[4/3]">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-xs text-slate-300">
            {ar ? 'جارٍ فتح الكاميرا…' : 'Opening the camera…'}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-400" />
              <p className="text-xs text-slate-200">{error}</p>
              <button type="button" onClick={start}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                <RefreshCw className="h-3.5 w-3.5" />{ar ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          </div>
        )}
        {ready && (
          <button type="button" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            title={ar ? 'تبديل الكاميرا' : 'Switch camera'}
            className="absolute top-2 end-2 rounded-lg bg-black/45 p-2 text-white hover:bg-black/65">
            <SwitchCamera className="h-4 w-4" />
          </button>
        )}
      </div>

      <button type="button" onClick={take} disabled={!ready || disabled || shots.length >= max}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f37121] py-3 text-sm font-bold text-white disabled:opacity-40">
        <Camera className="h-4 w-4" />
        {shots.length >= max
          ? (ar ? `الحدّ ${max} صور` : `Limit ${max} photos`)
          : (ar ? 'التقاط صورة المركبة' : 'Capture the vehicle')}
      </button>

      {!!shots.length && (
        <div className="flex flex-wrap gap-2">
          {shots.map((s, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.dataUrl} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
              <button type="button" onClick={() => onRemove(i)}
                className="absolute -top-1.5 -end-1.5 rounded-full bg-red-600 p-0.5 text-white">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
