/**
 * marketingController — the Marketing section (قسم التسويق).
 *
 * Two collections only: MarketingCampaign (the budgeted push) and
 * MarketingActivity (each dated post/ad/design done under it). Everything else
 * on the pages — the dashboard, the platform breakdown and the daily/weekly/
 * monthly report — is derived from those rows in memory. The volumes here are
 * small (tens of activities a week, not millions of trips), so a lean() find
 * over a date range plus a reduce is both simpler and faster than a pipeline,
 * and it keeps the bucketing logic (ISO weeks!) in plain JS where it's testable.
 */
const MarketingCampaign = require('../models/MarketingCampaign');
const MarketingActivity = require('../models/MarketingActivity');
const { emitToAll } = require('../websocket/socketManager');

const emit = (payload) => {
  try { emitToAll('marketing:updated', payload || {}); } catch (e) { /* socket optional */ }
};

// ── field whitelists ─────────────────────────────────────────────────────────
const CAMPAIGN_EDITABLE = [
  'name', 'nameAr', 'platform', 'objective', 'status', 'startDate', 'endDate',
  'budget', 'spend', 'revenue', 'owner', 'targetAudience', 'description', 'notes',
  'impressions', 'clicks', 'leads', 'conversions', 'reach', 'engagements',
];
const ACTIVITY_EDITABLE = [
  'date', 'campaign', 'platform', 'type', 'title', 'description', 'link',
  'metrics', 'performedBy', 'performedByName', 'notes',
];

const NUMERIC = new Set(['budget', 'spend', 'revenue', 'impressions', 'clicks', 'leads', 'conversions', 'reach', 'engagements']);
const METRIC_KEYS = ['impressions', 'clicks', 'likes', 'comments', 'shares', 'leads', 'reach'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pickFrom = (fields) => (body) => {
  const out = {};
  fields.forEach((f) => {
    if (body[f] === undefined) return;
    if (NUMERIC.has(f)) { out[f] = num(body[f]); return; }
    if (f === 'metrics') {
      const m = body.metrics && typeof body.metrics === 'object' ? body.metrics : {};
      out.metrics = METRIC_KEYS.reduce((acc, k) => { acc[k] = num(m[k]); return acc; }, {});
      return;
    }
    // Empty string on a ref field means "unset", not a cast error.
    if ((f === 'owner' || f === 'campaign' || f === 'performedBy') && !body[f]) { out[f] = null; return; }
    out[f] = body[f];
  });
  return out;
};
const pickCampaign = pickFrom(CAMPAIGN_EDITABLE);
const pickActivity = pickFrom(ACTIVITY_EDITABLE);

// ── date helpers (all YYYY-MM-DD strings) ────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Default window = the current calendar month to date.
const defaultRange = () => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { from: `${y}-${pad(m + 1)}-01`, to: toIso(now) };
};
const rangeOf = (q) => {
  const d = defaultRange();
  return { from: isDate(q.from) ? q.from : d.from, to: isDate(q.to) ? q.to : d.to };
};

// ISO-8601 week key, e.g. 2026-W03 — Monday-based, the convention the team's
// weekly report already follows.
const isoWeek = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;            // Sun = 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day);   // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${pad(week)}`;
};
// Monday of the ISO week a date falls in — used for the bucket label.
const weekStart = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - (day - 1));
  return toIso(dt);
};
const weekEnd = (iso) => {
  const s = weekStart(iso);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 6));
  return toIso(dt);
};

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sum an activity's metrics into an accumulator row.
const addMetrics = (row, a) => {
  const m = a.metrics || {};
  row.activities += 1;
  row.impressions += num(m.impressions);
  row.clicks += num(m.clicks);
  row.leads += num(m.leads);
  row.reach += num(m.reach);
  row.engagements += num(m.likes) + num(m.comments) + num(m.shares);
};
const blankRow = (extra) => ({ activities: 0, impressions: 0, clicks: 0, leads: 0, reach: 0, engagements: 0, ...extra });

// The schema declares ctr/cpl/roas as virtuals, but .lean() strips virtuals (no
// mongoose-lean-virtuals here), so every campaign leaving this controller gets
// them stamped on explicitly. The frontend can then read them uniformly.
const derive = (c) => {
  if (!c) return c;
  const plain = typeof c.toObject === 'function' ? c.toObject({ virtuals: true }) : c;
  return {
    ...plain,
    ctr: num(plain.impressions) > 0 ? (num(plain.clicks) / num(plain.impressions)) * 100 : 0,
    cpl: num(plain.leads) > 0 ? num(plain.spend) / num(plain.leads) : 0,
    roas: num(plain.spend) > 0 ? num(plain.revenue) / num(plain.spend) : 0,
  };
};

// ── dashboard ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const { from, to } = rangeOf(req.query);

    const [campaigns, activities] = await Promise.all([
      MarketingCampaign.find({}).populate('owner', 'firstName lastName').lean(),
      MarketingActivity.find({ date: { $gte: from, $lte: to } })
        .populate('campaign', 'name nameAr')
        .sort({ date: -1, createdAt: -1 })
        .lean(),
    ]);

    // A campaign counts toward the window if its own dates overlap it. Campaigns
    // with no dates at all are always counted (they'd otherwise be invisible).
    const inWindow = (c) => {
      if (!c.startDate && !c.endDate) return true;
      const s = c.startDate || '0000-01-01';
      const e = c.endDate || '9999-12-31';
      return s <= to && e >= from;
    };
    const windowCampaigns = campaigns.filter(inWindow);

    const totals = {
      campaigns: windowCampaigns.length,
      activeCampaigns: windowCampaigns.filter((c) => c.status === 'active').length,
      activities: activities.length,
      budget: windowCampaigns.reduce((a, c) => a + num(c.budget), 0),
      spend: windowCampaigns.reduce((a, c) => a + num(c.spend), 0),
      leads: 0,
      impressions: 0,
      clicks: 0,
      conversions: windowCampaigns.reduce((a, c) => a + num(c.conversions), 0),
      ctr: 0,
      cpl: 0,
    };

    const byPlatformMap = new Map();
    const byTypeMap = new Map();
    const timelineMap = new Map();

    activities.forEach((a) => {
      const m = a.metrics || {};
      totals.impressions += num(m.impressions);
      totals.clicks += num(m.clicks);
      totals.leads += num(m.leads);

      const p = a.platform || 'other';
      if (!byPlatformMap.has(p)) byPlatformMap.set(p, { platform: p, activities: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 });
      const pr = byPlatformMap.get(p);
      pr.activities += 1;
      pr.impressions += num(m.impressions);
      pr.clicks += num(m.clicks);
      pr.leads += num(m.leads);

      const ty = a.type || 'other';
      byTypeMap.set(ty, (byTypeMap.get(ty) || 0) + 1);

      if (!timelineMap.has(a.date)) timelineMap.set(a.date, { date: a.date, activities: 0, impressions: 0, clicks: 0, leads: 0 });
      const tr = timelineMap.get(a.date);
      tr.activities += 1;
      tr.impressions += num(m.impressions);
      tr.clicks += num(m.clicks);
      tr.leads += num(m.leads);
    });

    // Campaign spend lands on the platform it ran on, so the platform bars show
    // cost next to the impressions it bought.
    windowCampaigns.forEach((c) => {
      const p = c.platform || 'other';
      if (!byPlatformMap.has(p)) byPlatformMap.set(p, { platform: p, activities: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 });
      byPlatformMap.get(p).spend += num(c.spend);
    });

    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;

    const topCampaigns = [...windowCampaigns]
      .sort((a, b) => num(b.leads) - num(a.leads))
      .slice(0, 5)
      .map((c) => ({
        _id: c._id, name: c.name, nameAr: c.nameAr, platform: c.platform, status: c.status,
        budget: num(c.budget), spend: num(c.spend), leads: num(c.leads),
        impressions: num(c.impressions), clicks: num(c.clicks), conversions: num(c.conversions),
      }));

    res.json({
      range: { from, to },
      totals,
      byPlatform: [...byPlatformMap.values()].sort((a, b) => b.activities - a.activities),
      byType: [...byTypeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      timeline: [...timelineMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      topCampaigns,
      recentActivities: activities.slice(0, 10),
    });
  } catch (e) {
    console.error('marketing getDashboard error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

// ── report (daily / weekly / monthly) ────────────────────────────────────────
exports.getReport = async (req, res) => {
  try {
    const { from, to } = rangeOf(req.query);
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'weekly';

    const [activities, campaigns] = await Promise.all([
      MarketingActivity.find({ date: { $gte: from, $lte: to } }).lean(),
      MarketingCampaign.find({}).lean(),
    ]);

    const bucketOf = (iso) => {
      if (period === 'daily') return { key: iso, label: iso };
      if (period === 'monthly') return { key: iso.slice(0, 7), label: iso.slice(0, 7) };
      const key = isoWeek(iso);
      return { key, label: `${key} (${weekStart(iso)} → ${weekEnd(iso)})` };
    };

    const buckets = new Map();
    const ensure = (iso) => {
      const { key, label } = bucketOf(iso);
      if (!buckets.has(key)) buckets.set(key, blankRow({ bucket: key, label, conversions: 0, spend: 0 }));
      return buckets.get(key);
    };

    activities.forEach((a) => addMetrics(ensure(a.date), a));

    // A campaign's spend/conversions are attributed to the bucket its start date
    // falls in — the only date we can honestly place a lump-sum budget on.
    campaigns.forEach((c) => {
      if (!isDate(c.startDate) || c.startDate < from || c.startDate > to) return;
      const row = ensure(c.startDate);
      row.spend += num(c.spend);
      row.conversions += num(c.conversions);
    });

    const rows = [...buckets.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));

    const summary = rows.reduce(
      (acc, r) => {
        acc.buckets += 1;
        acc.activities += r.activities;
        acc.impressions += r.impressions;
        acc.clicks += r.clicks;
        acc.leads += r.leads;
        acc.reach += r.reach;
        acc.engagements += r.engagements;
        acc.conversions += r.conversions;
        acc.spend += r.spend;
        return acc;
      },
      { buckets: 0, activities: 0, impressions: 0, clicks: 0, leads: 0, reach: 0, engagements: 0, conversions: 0, spend: 0 }
    );
    summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
    summary.cpl = summary.leads > 0 ? summary.spend / summary.leads : 0;
    summary.avgActivitiesPerBucket = summary.buckets > 0 ? summary.activities / summary.buckets : 0;

    res.json({ period, range: { from, to }, rows, summary });
  } catch (e) {
    console.error('marketing getReport error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

// ── campaigns ────────────────────────────────────────────────────────────────
exports.listCampaigns = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.platform && req.query.platform !== 'all') filter.platform = req.query.platform;
    if (req.query.q && String(req.query.q).trim()) {
      const rx = new RegExp(escapeRx(String(req.query.q).trim()), 'i');
      filter.$or = [{ name: rx }, { nameAr: rx }, { description: rx }, { targetAudience: rx }, { notes: rx }];
    }
    const items = await MarketingCampaign.find(filter)
      .populate('owner', 'firstName lastName role')
      .sort({ startDate: -1, createdAt: -1 })
      .limit(2000)
      .lean();
    const rows = items.map(derive);
    res.json({ items: rows, total: rows.length });
  } catch (e) {
    console.error('marketing listCampaigns error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.getCampaign = async (req, res) => {
  try {
    const campaign = await MarketingCampaign.findById(req.params.id)
      .populate('owner', 'firstName lastName role')
      .lean();
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    const activities = await MarketingActivity.find({ campaign: req.params.id })
      .sort({ date: -1, createdAt: -1 })
      .limit(1000)
      .lean();
    res.json({ campaign: derive(campaign), activities });
  } catch (e) {
    console.error('marketing getCampaign error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Campaign name is required' });
    const doc = await MarketingCampaign.create({ ...pickCampaign(req.body), createdBy: req.user._id });
    emit({ kind: 'campaign', id: String(doc._id) });
    res.status(201).json({ campaign: derive(doc) });
  } catch (e) {
    console.error('marketing createCampaign error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const doc = await MarketingCampaign.findByIdAndUpdate(
      req.params.id,
      { $set: pickCampaign(req.body) },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ message: 'Campaign not found' });
    emit({ kind: 'campaign', id: String(req.params.id) });
    res.json({ campaign: derive(doc) });
  } catch (e) {
    console.error('marketing updateCampaign error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const doc = await MarketingCampaign.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Campaign not found' });
    // Keep the history: detach its activities rather than deleting them.
    await MarketingActivity.updateMany({ campaign: req.params.id }, { $set: { campaign: null } });
    emit({ kind: 'campaign', id: String(req.params.id), deleted: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('marketing deleteCampaign error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

// ── activities ───────────────────────────────────────────────────────────────
exports.listActivities = async (req, res) => {
  try {
    const filter = {};
    const { from, to, platform, campaign, type, q } = req.query;
    if (isDate(from) || isDate(to)) {
      filter.date = {};
      if (isDate(from)) filter.date.$gte = from;
      if (isDate(to)) filter.date.$lte = to;
    }
    if (platform && platform !== 'all') filter.platform = platform;
    if (type && type !== 'all') filter.type = type;
    if (campaign && campaign !== 'all') filter.campaign = campaign;
    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRx(String(q).trim()), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { notes: rx }, { performedByName: rx }, { link: rx }];
    }
    const items = await MarketingActivity.find(filter)
      .populate('campaign', 'name nameAr platform')
      .sort({ date: -1, createdAt: -1 })
      .limit(3000)
      .lean();
    res.json({ items, total: items.length });
  } catch (e) {
    console.error('marketing listActivities error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.createActivity = async (req, res) => {
  try {
    const data = pickActivity(req.body);
    if (!isDate(data.date)) return res.status(400).json({ message: 'A valid date (YYYY-MM-DD) is required' });
    if (!data.performedBy) { data.performedBy = req.user._id; }
    if (!data.performedByName) {
      data.performedByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    }
    const doc = await MarketingActivity.create({ ...data, createdBy: req.user._id });
    emit({ kind: 'activity', id: String(doc._id) });
    res.status(201).json({ activity: doc });
  } catch (e) {
    console.error('marketing createActivity error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.updateActivity = async (req, res) => {
  try {
    const data = pickActivity(req.body);
    if (data.date !== undefined && !isDate(data.date)) return res.status(400).json({ message: 'A valid date (YYYY-MM-DD) is required' });
    const doc = await MarketingActivity.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ message: 'Activity not found' });
    emit({ kind: 'activity', id: String(req.params.id) });
    res.json({ activity: doc });
  } catch (e) {
    console.error('marketing updateActivity error:', e.message);
    res.status(500).json({ message: e.message });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    const doc = await MarketingActivity.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Activity not found' });
    emit({ kind: 'activity', id: String(req.params.id), deleted: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('marketing deleteActivity error:', e.message);
    res.status(500).json({ message: e.message });
  }
};
