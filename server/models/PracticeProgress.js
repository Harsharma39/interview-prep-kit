const mongoose = require('mongoose');

const practiceProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Kit', required: true, index: true },
  confidence: { type: Map, of: Number, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

practiceProgressSchema.index({ userId: 1, kitId: 1 }, { unique: true });
module.exports = mongoose.model('PracticeProgress', practiceProgressSchema);