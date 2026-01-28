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
    type: Number,
    default: 0,
    min: 0
  },
  sales: { // This will now represent salesAmount
    type: Number,
    default: 0,
    min: 0
  },
  salesCount: {
    type: Number,
    default: 0,
    min: 0
  },
  salesDetails: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster queries
reportSchema.index({ employee: 1, date: -1 });
reportSchema.index({ date: -1 });
reportSchema.index({ employee: 1, date: 1 }); // Multiple reports allowed per day

module.exports = mongoose.model('Report', reportSchema);
