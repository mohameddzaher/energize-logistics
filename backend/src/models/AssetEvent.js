const mongoose = require('mongoose');

// The movement log for one custody item (`Asset`).
//
// An Asset document only ever shows the CURRENT state — who holds it right now.
// Everything that happened before is here: it entered the store, it was handed
// to Ahmed, it moved to Sara, it came back damaged, it was written off. That
// history is what an audit actually asks for, and it is why the same document
// is reused for a device's whole life instead of a new row per handover.
//
// Events are append-only. Nothing in the app updates or deletes one; correcting
// a mistake means recording the correcting event.
const assetEventSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },

    action: {
      type: String,
      required: true,
      enum: [
        'added_to_store',  // created on the shelf
        'assigned',        // shelf → employee, or created straight into custody
        'transferred',     // employee → employee, without passing through the store
        'returned',        // employee → shelf
        'damaged',         // reported broken while held
        'lost',            // reported missing while held
        'retired',         // out of circulation for good (dead, written off)
        // ── والبيعُ حدثٌ بذاته لا «إخراجٌ من الخدمة» ─────────────────────────
        // كان يُسجَّل «retired» مع الميت والمشطوب. وهما مختلفان: المشطوبُ خسارةٌ
        // والمباعُ دخل. وسؤالُ «كم بعنا العامَ الماضي وبكم» لا جوابَ له إن كان
        // البيعُ مخلوطًا بالتالف.
        'sold',            // خرج من ملكنا ببيع — لموظّفٍ أو لخارجيّ
        'updated',         // details edited (kept so the trail has no silent gaps)
      ],
    },

    // Both sides of a handover. `from` is null when the item came off the shelf,
    // `to` is null when it went back to it.
    fromEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    toEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

    // مشترٍ من خارج الشركة — لا سجلَّ له عندنا، فيُكتب اسمُه.
    buyerName: { type: String, trim: true, default: '' },
    price: { type: Number, default: 0 },

    date: { type: String }, // YYYY-MM-DD — the day it happened, not the day it was typed
    condition: { type: String, trim: true },

    // Money owed for a lost or damaged item, if the company decided to charge it.
    cost: { type: Number, default: 0 },

    notes: { type: String, trim: true },

    // Who recorded it. Kept even if the user is later deleted — the trail must
    // still say a person did this.
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    section: { type: String, default: 'it', trim: true }, // 'it' | 'hr'
  },
  { timestamps: true }
);

// The timeline query: every event for one item, newest first.
assetEventSchema.index({ asset: 1, createdAt: -1 });
// "What happened to this employee's custody?" across all their items.
assetEventSchema.index({ toEmployee: 1, createdAt: -1 });
assetEventSchema.index({ fromEmployee: 1, createdAt: -1 });

module.exports = mongoose.model('AssetEvent', assetEventSchema);
