const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Meeting title is required'],
    trim: true
  },
  description: {
    type: String
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  attendees: [{
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'tentative'],
      default: 'pending'
    },
    responseTime: Date
  }],
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  location: {
    type: String
  },
  meetingType: {
    type: String,
    enum: ['in-person', 'virtual', 'hybrid'],
    default: 'in-person'
  },
  meetingLink: {
    type: String
  },
  recurrence: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly'],
    default: 'none'
  },
  recurrenceEndDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'postponed'],
    default: 'scheduled'
  },
  agenda: [{
    topic: String,
    duration: Number, // in minutes
    presenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }
  }],
  minutes: {
    type: String
  },
  attachments: [{
    name: String,
    url: String
  }],
  reminders: [{
    time: Date,
    sent: { type: Boolean, default: false }
  }]
}, {
  timestamps: true
});

// Indexes for faster queries
meetingSchema.index({ startTime: 1 });
meetingSchema.index({ organizer: 1, startTime: -1 });
meetingSchema.index({ status: 1, startTime: 1 });
meetingSchema.index({ 'attendees.employee': 1, startTime: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);

