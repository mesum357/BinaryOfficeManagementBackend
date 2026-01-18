const mongoose = require('mongoose');

const leavePolicySchema = new mongoose.Schema({
  leaveType: {
    type: String,
    enum: ['annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other'],
    required: true,
    unique: true
  },
  yearlyLimit: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
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

module.exports = mongoose.model('LeavePolicy', leavePolicySchema);

