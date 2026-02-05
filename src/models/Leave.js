const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  leaveType: {
    type: String,
    enum: ['annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other'],
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  totalDays: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: [true, 'Leave reason is required']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  appliedOn: {
    type: Date,
    default: Date.now
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedOn: {
    type: Date
  },
  reviewerComments: {
    type: String
  },
  attachments: [{
    name: String,
    url: String
  }],
  isEmergency: {
    type: Boolean,
    default: false
  },
  contactDuringLeave: {
    email: String
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Calculate total days before saving
leaveSchema.pre('save', function (next) {
  if (this.startDate && this.endDate) {
    const diffTime = Math.abs(this.endDate - this.startDate);
    this.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }
  next();
});

// Indexes for faster queries
leaveSchema.index({ employee: 1, status: 1, createdAt: -1 });
leaveSchema.index({ status: 1, startDate: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Leave', leaveSchema);

