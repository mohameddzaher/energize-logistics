/**
 * Files picked in a form, read as base64 data URLs for the JSON upload the system uses.
 * Phone photos are often 4–8 MB each, and several of them in one request ran past the upload cap; a large image is redrawn at most 2000px wide as JPEG first (a receipt or a bond stays legible), other files go as they are.
 */
export type UploadFile = { dataUrl: string; fileName: string; size: number };

const MAX_FILE = 20 * 1024 * 1024;
const SHRINK_OVER = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;

const readAsDataUrl = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('read failed'));
  r.readAsDataURL(f);
});

async function shrinkImage(f: File): Promise<UploadFile | null> {
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    if (size >= f.size) return null;
    return { dataUrl, fileName: f.name.replace(/\.[^.]+$/, '') + '.jpg', size };
  } catch { return null; }
}

/** Reads the files; throws a message naming a file over 20 MB. */
export async function readUploadFiles(files: File[], ar = true): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE) throw new Error(ar ? `الملف «${f.name}» أكبر من 20 ميجابايت.` : `"${f.name}" is larger than 20MB.`);
    const small = f.type.startsWith('image/') && f.type !== 'image/gif' && f.size > SHRINK_OVER ? await shrinkImage(f) : null;
    // eslint-disable-next-line no-await-in-loop
    out.push(small || { dataUrl: await readAsDataUrl(f), fileName: f.name, size: f.size });
  }
  return out;
}
