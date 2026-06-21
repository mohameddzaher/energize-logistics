// Shared double-entry poster so any module (procurement, future payroll…) can
// write balanced journal entries into Accounting without duplicating logic.
const mongoose = require('mongoose');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Resolve { code -> ObjectId } for the requested account codes.
const accountIdsByCode = async (codes) => {
  const ChartAccount = require('../models/ChartAccount');
  const accts = await ChartAccount.find({ code: { $in: codes } }).select('code').lean();
  const m = {};
  accts.forEach((a) => { m[a.code] = a._id; });
  return m;
};

const nextEntryNumber = async () => {
  const JournalEntry = require('../models/JournalEntry');
  const count = await JournalEntry.estimatedDocumentCount();
  return `JE-${String(count + 1).padStart(6, '0')}`;
};

// Post a balanced entry. `lines` = [{ account, debit, credit, description }].
// `source` = { type, refId, auto }. Returns the created entry, or null if the
// lines don't balance / total zero (caller can decide whether that's fatal).
const postJournalEntry = async ({ date, memo, lines, source, createdBy }) => {
  const JournalEntry = require('../models/JournalEntry');
  const clean = (lines || [])
    .map((l) => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit), description: l.description }))
    .filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const totalDebit = round2(clean.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (!totalDebit || totalDebit !== totalCredit) return null;
  return JournalEntry.create({
    entryNumber: await nextEntryNumber(),
    date: date ? new Date(date) : new Date(),
    memo, lines: clean, totalDebit, totalCredit, status: 'posted',
    source: { type: source?.type || 'manual', refId: source?.refId, auto: source?.auto !== false },
    createdBy,
  });
};

// Remove the auto entries posted for a given source document (used when a
// bill/payment is deleted so the ledger stays consistent).
const reverseSource = async (type, refId) => {
  if (!refId || !mongoose.isValidObjectId(refId)) return;
  const JournalEntry = require('../models/JournalEntry');
  await JournalEntry.deleteMany({ 'source.type': type, 'source.refId': refId, 'source.auto': true });
};

module.exports = { accountIdsByCode, postJournalEntry, reverseSource, round2 };
