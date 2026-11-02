const mongoose = require('mongoose');

/**
 * Start-of-shift duty check: a rider leaves the station only with the supervisor standing over him. Each rider has one row per day: which supervisor sent him out, when, and a photo of his vehicle then, so damage on return can be placed before or after departure.
 * The photo is captured from the camera, not uploaded (an upload could be old or of another bike); the UI offers no upload button and `captureSource` records where it came from.
 * The unique index on (rider, day) prevents two checks per rider per day, which would make the departed count wrong; corrections edit the row.
 */
const photoSchema = new mongoose.Schema(
  {
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number },
    // What the photo says about itself: live capture or not. See the file header.
    captureSource: { type: String, enum: ['camera', 'unknown'], default: 'camera' },
    // What is in the photo: the rider himself, the scooter, or the box. Three separate photos per departure, so reports can show scooters only or boxes only. Old photos from before this split were all of the vehicle.
    // 'ad' is advertising content: a shot of the sticker on the scooter, added on Thursday only and repeated. See b2cDutyController.
    kind: { type: String, enum: ['rep', 'vehicle', 'box', 'ad'], default: 'vehicle', index: true },
    takenAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const b2cDutyCheckSchema = new mongoose.Schema(
  {
    /**
     * Who is checked: his row in the section register. It used to be `rep`, his account on the delivery app (`B2CRep`, 593 rows of legacy accounts). That is not the list of our riders: theirs is the light transport register (157 riders), which has identity, plate, supervisor and sponsorship. The screen showed 586 names the section did not know and each had to be linked to a register row by name, a match that gets ambiguous at that scale.
     * So the subject is now the register row itself: no matching, and plate, identity and supervisor are already on the row. `rep` stays optional: old duty-check rows were written with it, and history is not rewritten.
     */
    ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', index: true },
    rep: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CRep', index: true },
    /** Or the scooter itself. A check falls on the rider or on the scooter and the two are linked: a scooter check whose rider is in the register (or authorized on it) is also written on the rider, and a rider check is written on his scooter, so "done" shows on both sides from one row. `vehicle` is a row in the vehicle register and `vehicleKey` is its plate key (registryPlateKey). */
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', index: true },
    vehicleKey: { type: String, trim: true, index: true },
    // The supervisor who stood over the departure, not the one who owns the rider in the register. Someone else may stand in for him one day, and accountability is on whoever acted, not whoever was responsible.
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    supervisorName: { type: String, trim: true },   // Name snapshot that remains if the account changes
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject', index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },

    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, index: true }, // 'YYYY-MM-DD'
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    day: { type: Number, required: true },
    checkedAt: { type: Date, default: Date.now },

    /** Outcome: sent out, did not attend, or blocked from leaving. Blocked is not absence: the vehicle is unfit, which is the supervisor's decision, not the rider's failure. */
    outcome: {
      type: String,
      enum: ['started', 'absent', 'blocked'],
      default: 'started',
      index: true,
    },

    vehicleType: { type: String, enum: ['motorcycle', 'car', 'other', ''], default: '' },
    vehiclePlate: { type: String, trim: true },
    // Vehicle condition is read from a list managed in the section settings, not free text.
    conditionAr: { type: String, trim: true },
    hasDamage: { type: Boolean, default: false, index: true },
    damageNotes: { type: String, trim: true },
    notes: { type: String, trim: true },

    photos: { type: [photoSchema], default: [] },

    /** Supervisor's location at check time, if the browser allows it. Not required: the station may have no signal, and refusing permission is not an accusation. But when present it answers what the photo alone cannot: was he really there? */
    location: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
    },

    // Management review: the photo is read and judged sound or to be held accountable.
    review: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
      verdict: { type: String, enum: ['ok', 'flagged', ''], default: '' },
      note: { type: String, trim: true },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One row per rider per day; see the file header.
/**
 * One row per rider per day, with a partial filter rather than sparse. `sparse` on a compound index drops a row only when all its keys are missing, and `dateKey` is always present, so a row without `rep` is indexed as {null, day} and collides with every other row without it that day.
 * This happened: the subject became a light transport register row so `rep` was no longer written, the first check of the day succeeded and the server answered every later one with "a check was already recorded for this rider today", for a different rider entirely. One rider a day for the whole company.
 * So the condition is partial (`partialFilterExpression`): a row is indexed only if the key is a real identifier. The rule (one row per rider per day) stays and does not apply to an absence.
 * Changing the properties of an existing index does not happen by editing this file: Mongoose creates missing indexes and does not rebuild existing ones. Drop and rebuild with `scripts/fixDutyCheckIndexes.js`.
 */
b2cDutyCheckSchema.index(
  { ltEmployee: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { ltEmployee: { $type: 'objectId' } }, name: 'ltEmployee_1_dateKey_1_partial' },
);
b2cDutyCheckSchema.index(
  { rep: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { rep: { $type: 'objectId' } }, name: 'rep_1_dateKey_1_partial' },
);
// The management screen opens on a day, then filters by supervisor, branch or project.
b2cDutyCheckSchema.index(
  { vehicle: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { vehicle: { $type: 'objectId' } }, name: 'vehicle_1_dateKey_1_partial' },
);
/** A new check carries the vehicle reference when its plate is known. The controller resolved the scooter by the Arabic plate key, so a plate written in Latin letters or another format was dropped (1,181 checks had a plate with no reference). It is now resolved here by the unified key (utils/vehicleRef). It is not linked if the vehicle already has a row that day: a scooter shared by two riders is linked to the first only (the index below enforces it). */
b2cDutyCheckSchema.pre('save', async function () {
  if (!this.isNew || this.vehicle || !String(this.vehiclePlate || '').trim()) return;
  try {
    const hit = await require('../utils/vehicleRef').resolve(this.vehiclePlate, '_id plateKey plateNumber');
    if (!hit) return;
    if (await this.constructor.exists({ vehicle: hit._id, dateKey: this.dateKey })) return;
    this.vehicle = hit._id;
    if (!this.vehicleKey) this.vehicleKey = hit.plateKey || require('../utils/plateKey').registryPlateKey(hit.plateNumber) || undefined;
  } catch (_) { /* Linking must not fail the save. */ }
});

b2cDutyCheckSchema.index({ dateKey: 1, supervisor: 1 });
b2cDutyCheckSchema.index({ dateKey: 1, branch: 1 });
b2cDutyCheckSchema.index({ dateKey: 1, outcome: 1 });
b2cDutyCheckSchema.index({ supervisor: 1, date: -1 });
b2cDutyCheckSchema.index({ hasDamage: 1, date: -1 });

module.exports = mongoose.model('B2CDutyCheck', b2cDutyCheckSchema);
