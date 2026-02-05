const mongoose = require('mongoose');

const recruitmentSchema = new mongoose.Schema({
  jobTitle: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  description: {
    type: String,
    required: true
  },
  requirements: [String],
  responsibilities: [String],
  qualifications: {
    education: String,
    experience: String,
    skills: [String]
  },
  employmentType: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'internship'],
    default: 'full-time'
  },
  salaryRange: {
    min: Number,
    max: Number,
    currency: { type: String, default: 'PKR' }
  },
  location: {
    type: String
  },
  openings: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['draft', 'open', 'on-hold', 'closed', 'filled'],
    default: 'draft'
  },
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  postedAt: {
    type: Date
  },
  closingDate: {
    type: Date
  },
  applicants: [{
    name: String,
    email: String,
    phone: String,
    resume: String,
    coverLetter: String,
    appliedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['new', 'screening', 'interview', 'offered', 'hired', 'rejected'],
      default: 'new'
    },
    notes: String,
    interviewDate: Date,
    rating: {
      type: Number,
      min: 1,
      max: 5
    }
  }],
  hiringManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }
}, {
  timestamps: true
});

// Index for faster queries
recruitmentSchema.index({ status: 1, department: 1 });
recruitmentSchema.index({ postedAt: -1 });

module.exports = mongoose.model('Recruitment', recruitmentSchema);

