const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    unique: true
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  designation: {
    type: String,
    required: true
  },
  dateOfJoining: {
    type: Date,
    required: true
  },
  dateOfBirth: {
    type: Date
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: 'Pakistan' }
  },
  emergencyContact: {
    name: String,
    relation: String,
    phone: String
  },
  salary: {
    basic: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 }
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountTitle: String
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  avatar: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'on-leave', 'terminated', 'resigned', 'rejected'],
    default: 'pending'
  },
  leaveBalance: {
    annual: { type: Number, default: 20 },
    sick: { type: Number, default: 10 },
    casual: { type: Number, default: 5 },
    maternity: { type: Number, default: 90 },
    paternity: { type: Number, default: 10 },
    other: { type: Number, default: 0 }
  },
  skills: [String],
  expertise: [String],
  documents: [{
    name: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster queries (email and employeeId already have unique indexes via unique: true)
employeeSchema.index({ status: 1, department: 1 });

// Virtual for full name
employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Generate employee ID before saving
employeeSchema.pre('save', async function (next) {
  if (!this.employeeId) {
    const count = await mongoose.model('Employee').countDocuments();
    this.employeeId = `EMP${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Employee', employeeSchema);

