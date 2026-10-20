const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Local-disk file storage for employee documents. We intentionally avoid a file
// upload dependency (multer): the frontend sends the file as a base64 data URL in
// JSON, and we decode + write it here. Filenames are randomised so the public
// /uploads path is unguessable. Returns the metadata to persist on the document.

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const EMPLOYEES_DIR = path.join(UPLOAD_ROOT, 'employees');

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const ALLOWED_MIME = new Set(Object.keys(EXT_BY_MIME));

// ── والفيديو لمن يطلبه صراحةً ────────────────────────────────────────────────
// المستنداتُ لا فيديوَ فيها، فلا يُفتَح لها. وبلاغُ العطل (شاشةٌ تقطع، باورٌ
// مفصول) يُفهَم من مقطعٍ قصيرٍ أكثرَ من صورة — فمن احتاجه مرّر `allowVideo`.
const VIDEO_EXT_BY_MIME = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/3gpp': '3gp', 'video/x-m4v': 'm4v',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

// Parse a data URL ("data:<mime>;base64,<data>") into { mimeType, buffer }.
const parseDataUrl = (dataUrl) => {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
};

// Save a base64 data URL under uploads/<subdir>.
// Throws Error with a friendly message on validation failure.
// `opts.allowVideo` يقبل مقاطعَ الفيديو، و`opts.maxBytes` يضيّق الحدَّ (لا يوسّعه).
const saveUploadFile = (dataUrl, subdir, originalName = '', opts = {}) => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Invalid file data');
  const { mimeType, buffer } = parsed;
  const isVideo = !!opts.allowVideo && Object.prototype.hasOwnProperty.call(VIDEO_EXT_BY_MIME, mimeType);
  if (!ALLOWED_MIME.has(mimeType) && !isVideo) {
    throw new Error(opts.allowVideo
      ? 'Unsupported file type. Use an image or a video (mp4, mov, webm).'
      : 'Unsupported file type. Use an image, PDF, Word or Excel file.');
  }
  const limit = Math.min(MAX_BYTES, Number(opts.maxBytes) || MAX_BYTES);
  if (buffer.length > limit) throw new Error(`File too large (max ${Math.round(limit / 1024 / 1024)}MB).`);

  const safeSub = String(subdir || 'misc').replace(/[^a-z0-9_-]/gi, '');
  const dir = path.join(UPLOAD_ROOT, safeSub);
  ensureDir(dir);
  const ext = EXT_BY_MIME[mimeType] || VIDEO_EXT_BY_MIME[mimeType] || 'bin';
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);

  return {
    // Served under /api/uploads so the Next.js /api/* proxy forwards it to the
    // backend (keeps everything same-origin / first-party — see lib/api.ts).
    fileUrl: `/api/uploads/${safeSub}/${name}`,
    fileName: (originalName || name).slice(0, 200),
    mimeType,
    size: buffer.length,
  };
};

const saveEmployeeFile = (dataUrl, originalName = '') => saveUploadFile(dataUrl, 'employees', originalName);

// Best-effort delete of a stored file given its public /api/uploads/... url.
const deleteStoredFile = (fileUrl) => {
  try {
    if (!fileUrl || !fileUrl.startsWith('/api/uploads/')) return;
    const abs = path.join(UPLOAD_ROOT, fileUrl.replace('/api/uploads/', ''));
    // Guard against path traversal — must stay inside the upload root.
    if (!abs.startsWith(UPLOAD_ROOT)) return;
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) { /* ignore */ }
};

module.exports = { saveEmployeeFile, saveUploadFile, deleteStoredFile, UPLOAD_ROOT };
