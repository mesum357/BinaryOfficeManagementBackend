const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Department name is required'],
    unique: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  description: {
    type: String
  },
  head: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  parentDepartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  budget: {
    type: Number,
    default: 0
  },
  location: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual to get employee count
departmentSchema.virtual('employeeCount', {
  ref: 'Employee',
  localField: '_id',
  foreignField: 'department',
  count: true
});

module.exports = mongoose.model('Department', departmentSchema);

