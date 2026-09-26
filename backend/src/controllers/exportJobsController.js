/**
 * التصديرُ الكبير يُبنى في الخلفيّة ويصل صاحبَه بإشعار.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * «كلُّ الكشوف» ستّةٌ وثلاثون ألفَ صفٍّ واثنان وعشرون ميجابايت: نصفُ دقيقةٍ
 * يقفُ فيها الموظّفُ أمام صفحةٍ لا تستجيب، وإن أغلقها أو تعثّرت شبكتُه ضاع
 * العملُ وأُعيد من أوّله. وقبل ذلك كان يوقف الخادمَ عن خدمة البقيّة — عولج
 * بنقل الكتابة إلى خيطٍ عامل (utils/xlsxBuilder) — وبقي الانتظارُ نفسُه.
 *
 * فصار طلبًا: يُسجَّل، ويُردّ على صاحبه في اللحظة «جارٍ التجهيز»، ويُبنى الملفُّ
 * في الخادم ثمّ يصله إشعارٌ فيه رابطُه. ويبقى الملفُّ يومًا كاملًا فينزّله متى
 * شاء ومن أيّ جهاز.
 *
 * ── وطلبٌ واحدٌ في كلّ مرّة ─────────────────────────────────────────────────
 * البناءُ حسابٌ ثقيل. فلو ضغط عشرةٌ «تصدير» في دقيقةٍ بُنيت عشرةُ ملفّاتٍ معًا
 * فخنقت الخادم. فالطلباتُ تُصفّ وتُنفَّذ واحدًا بعد واحد.
 */
const fs = require('fs');
const path = require('path');
const ExportJob = require('../models/ExportJob');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');

const DIR = path.join(__dirname, '..', '..', 'uploads', 'exports');
const ensureDir = () => { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* */ } };

/**
 * ما يمكن تصديرُه. المفتاحُ يأتي من المتصفّح، والدالّةُ هنا — فلا يُشتقّ من
 * الطلب مسارٌ ولا اسمُ ملفّ.
 */
const RUNNERS = {
  workflows: {
    ar: 'سير عمل التشغيل',
    en: 'Operations workflow',
    run: (query, user) => require('./workflowController').buildExportFile(query, user),
  },
  'operations-private': {
    ar: 'التشغيل — خاصّ',
    en: 'Operations — private',
    run: (query, user) => require('./operationsPrivateController').buildExportFile(query, user),
  },
};

let working = false;
async function pump() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const job = await ExportJob.findOneAndUpdate(
        { status: 'queued' },
        { $set: { status: 'running', startedAt: new Date() } },
        { new: true, sort: { createdAt: 1 } },
      );
      if (!job) break;
      const runner = RUNNERS[job.kind];
      try {
        if (!runner) throw new Error(`unknown export kind: ${job.kind}`);
        ensureDir();
        const { buf, rows, name } = await runner.run(job.query || {}, { _id: job.requestedBy, role: job.role });
        const fileName = name || `${job.kind}-${new Date().toISOString().slice(0, 10)}.xlsx`;
        const filePath = path.join(DIR, `${job._id}.xlsx`);
        fs.writeFileSync(filePath, buf);
        job.status = 'done';
        job.rows = rows || 0;
        job.fileName = fileName;
        job.filePath = filePath;
        job.size = buf.length;
        job.finishedAt = new Date();
        await job.save();
        await createNotification({
          recipient: job.requestedBy,
          type: 'status_changed',
          title: 'ملفُّ التصدير جاهز',
          message: `${runner.ar} — ${job.rows.toLocaleString('en-US')} صفًّا. اضغط لتنزيله.`,
          relatedEntity: 'ExportJob',
          relatedEntityId: job._id,
        }).catch(() => { /* الملفُّ جاهزٌ وإن لم يصل الإشعار */ });
      } catch (e) {
        job.status = 'failed';
        job.error = String(e.message || e).slice(0, 300);
        job.finishedAt = new Date();
        await job.save().catch(() => { /* */ });
        console.error('[export]', job.kind, e.message);
      }
      try { emitToAll('export:job', { id: String(job._id), status: job.status, user: String(job.requestedBy) }); } catch (_) { /* */ }
    }
  } finally {
    working = false;
  }
}

// POST /api/exports/jobs  { kind, query }
exports.create = async (req, res) => {
  try {
    const kind = String(req.body.kind || '');
    if (!RUNNERS[kind]) return res.status(400).json({ message: 'نوعُ تصديرٍ غير معروف' });
    // ولا يُكدِّس أحدٌ طلباتٍ على نفسه: طلبُه الجاري يُعاد إليه كما هو.
    const open = await ExportJob.findOne({ requestedBy: req.user._id, kind, status: { $in: ['queued', 'running'] } }).lean();
    if (open) return res.status(200).json({ job: shape(open), queued: true });

    const job = await ExportJob.create({
      kind,
      query: req.body.query || {},
      requestedBy: req.user._id,
      requestedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
      role: req.user.role,
    });
    pump().catch(() => { /* السجلُّ يحمل الخطأ */ });
    res.status(202).json({ job: shape(job) });
  } catch (e) {
    console.error('export create:', e);
    res.status(500).json({ message: 'تعذّر بدء التصدير' });
  }
};

// GET /api/exports/jobs/:id
exports.status = async (req, res) => {
  try {
    const job = await ExportJob.findById(req.params.id).lean();
    if (!job || !mine(job, req.user)) return res.status(404).json({ message: 'غير موجود' });
    res.json({ job: shape(job) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّرت قراءة حالة التصدير' });
  }
};

// GET /api/exports/jobs — آخرُ طلباتِ هذا المستخدم
exports.list = async (req, res) => {
  try {
    const jobs = await ExportJob.find({ requestedBy: req.user._id }).sort({ createdAt: -1 }).limit(20).lean();
    res.json({ jobs: jobs.map(shape) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّرت قراءة التصديرات' });
  }
};

// GET /api/exports/jobs/:id/download
exports.download = async (req, res) => {
  try {
    const job = await ExportJob.findById(req.params.id).lean();
    if (!job || !mine(job, req.user)) return res.status(404).json({ message: 'غير موجود' });
    if (job.status !== 'done') return res.status(409).json({ message: 'الملفُّ لم يجهز بعد' });
    if (!job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(410).json({ message: 'انتهت صلاحيّةُ الملفّ — أعد التصدير' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${job.fileName}`);
    res.setHeader('Content-Length', String(job.size));
    fs.createReadStream(job.filePath).pipe(res);
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تنزيل الملفّ' });
  }
};

/** صاحبُ الطلب وحدَه — والملفُّ قد يحمل مالًا لا يراه غيرُه. */
const mine = (job, user) => String(job.requestedBy) === String(user._id);

const shape = (j) => ({
  _id: String(j._id),
  kind: j.kind,
  status: j.status,
  rows: j.rows,
  fileName: j.fileName,
  size: j.size,
  error: j.error,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
});

/** حذفُ ما انتهت صلاحيّتُه — ملفًّا وسجلًّا. تُنادى من مهامّ الإقلاع. */
exports.startExportCleanup = () => {
  const sweep = async () => {
    try {
      const old = await ExportJob.find({ expiresAt: { $lte: new Date() } }).lean();
      for (const j of old) {
        if (j.filePath) { try { fs.unlinkSync(j.filePath); } catch (_) { /* قد يكون مُسِح */ } }
      }
      if (old.length) await ExportJob.deleteMany({ _id: { $in: old.map((j) => j._id) } });
    } catch (e) { console.error('[export] cleanup:', e.message); }
  };
  setTimeout(sweep, 2 * 60 * 1000);
  setInterval(sweep, 60 * 60 * 1000);
};
