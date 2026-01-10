const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  headset: {
    type: Boolean,
    default: false
  },
  sales: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Index for faster queries
reportSchema.index({ employee: 1, date: -1 });
reportSchema.index({ date: -1 });
reportSchema.index({ employee: 1, date: 1 }, { unique: true }); // One report per employee per day

module.exports = mongoose.model('Report', reportSchema);
