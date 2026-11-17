/**
 * Runs an existing route handler after replying, when the client asks with `background: true`.
 * The handler is called unchanged with a stand-in `res` that records its status and body; the outcome is stored on a
 * BackgroundJob the client polls (GET .../jobs/:id). Without the flag the handler runs as before.
 */
const BackgroundJob = require('../models/BackgroundJob');

function recorder() {
  const out = { code: 200, body: undefined };
  const res = {
    headersSent: false,
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; res.headersSent = true; return res; },
    send(b) { out.body = b; res.headersSent = true; return res; },
    set() { return res; },
    setHeader() { return res; },
  };
  return { res, out };
}

const inBackground = (kind, handler) => async (req, res, next) => {
  if (req.body?.background !== true) return handler(req, res, next);
  const job = await BackgroundJob.create({ kind, user: req.user._id });
  res.status(202).json({ jobId: String(job._id) });
  setImmediate(async () => {
    const { res: fake, out } = recorder();
    try {
      await handler(req, fake, () => {});
      const ok = out.code < 400;
      await BackgroundJob.updateOne({ _id: job._id }, { $set: {
        status: ok ? 'done' : 'error', httpStatus: out.code, result: ok ? out.body ?? null : null,
        message: ok ? '' : String(out.body?.message || 'تعذّر التنفيذ'), finishedAt: new Date(),
      } });
    } catch (e) {
      await BackgroundJob.updateOne({ _id: job._id }, { $set: { status: 'error', httpStatus: 500, message: e.message || 'تعذّر التنفيذ', finishedAt: new Date() } }).catch(() => {});
    }
  });
  return undefined;
};

/** GET handler: the caller's own job only. */
async function getJob(req, res) {
  try {
    const job = await BackgroundJob.findOne({ _id: req.params.jobId, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ message: 'المهمّة غير موجودة' });
    return res.json({ status: job.status, httpStatus: job.httpStatus, result: job.result, message: job.message });
  } catch (e) { return res.status(400).json({ message: 'معرّف غير صالح' }); }
}

module.exports = { inBackground, getJob };
