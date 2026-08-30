const mongoose = require('mongoose');

// A truck the shipment-orders section can put on a load. `supplier: null`
// means it is OUR fleet; otherwise it belongs to that 3PL supplier.
//
// The default driver ride along so that picking the truck on the create form
// fills the driver in one tap — the automation the section exists for. Both
// stay editable per shipment; a truck driven by someone else today is normal.
const shipmentOrderVehicleSchema = new mongoose.Schema(
  {
    plate: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: '' },        // e.g. "مرسيدس أكتروس أبيض"
    truckType: { type: String, trim: true, default: '' },   // same vocabulary as the form field
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },
    defaultDriverName: { type: String, trim: true, default: '' },
    defaultDriverPhone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // بياناتُ المركبة كما تحملها منصّةُ الأوبريشن.
    externalId: { type: String, trim: true, default: '', index: true },
    modelYear: { type: String, trim: true, default: '' },
    recordNumber: { type: String, trim: true, default: '' },
    // بطاقةُ التشغيل وانتهاؤها: مركبةٌ بطاقتُها منتهيةٌ لا تُحمَّل — يُوقفها
    // الطريقُ لا نحن، فمعرفةُ التاريخ قبل الإسناد توفّر حمولةً متعطّلة.
    operationCardNumber: { type: String, trim: true, default: '' },
    operationCardExpiry: { type: String, trim: true, default: '' },
    insuranceDetails: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderVehicleSchema.index({ plate: 1 });

module.exports = mongoose.models.ShipmentOrderVehicle
  || mongoose.model('ShipmentOrderVehicle', shipmentOrderVehicleSchema);
