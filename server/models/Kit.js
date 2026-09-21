const mongoose = require('mongoose');

const kitSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  inputHash: { type: String, required: true, index: true },
  jd: { type: String, required: true },
  companyUrl: { type: String, required: true },
  days: { type: Number, required: true },
  displayName: { type: String, trim: true, maxlength: 120 },
  status: { type: String, enum: ['queued', 'researching', 'analyzing', 'generating', 'validating', 'complete', 'failed'], default: 'queued' },
  generationStage: { type: String, default: 'queued' },
  generationToken: { type: String, default: '' },
  error: { code: String, message: String },
  kit: { type: mongoose.Schema.Types.Mixed },
  contentState: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('Kit', kitSchema);
