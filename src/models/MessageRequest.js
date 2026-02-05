const mongoose = require('mongoose');

const messageRequestSchema = new mongoose.Schema({
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  message: {
    type: String,
    default: ''
  },
  respondedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
messageRequestSchema.index({ to: 1, status: 1 });
messageRequestSchema.index({ from: 1, to: 1 });

// Prevent duplicate pending requests
messageRequestSchema.index({ from: 1, to: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('MessageRequest', messageRequestSchema);

