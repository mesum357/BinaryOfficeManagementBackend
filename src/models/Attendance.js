const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  checkIn: {
    time: Date,
    location: {
      latitude: Number,
      longitude: Number
    },
    ipAddress: String
  },
  checkOut: {
    time: Date,
    location: {
      latitude: Number,
      longitude: Number
    },
    ipAddress: String
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late', 'early', 'overtime', 'clocked-out', 'early-clockout', 'half-day', 'on-leave', 'holiday', 'weekend'],
    default: 'absent'
  },
  workingHours: {
    type: Number,
    default: 0
  },
  overtime: {
    type: Number,
    default: 0
  },
  breaks: [{
    startTime: {
      type: Date,
      required: true
    },
    endTime: Date,
    duration: Number, // in minutes
    reason: {
      type: String,
      enum: ['washroom', 'lunch', 'cigarette', 'break'],
      default: 'break'
    }
  }],
  notes: {
    type: String
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for unique attendance per employee per day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

// Calculate working hours before saving
attendanceSchema.pre('save', function (next) {
  if (this.checkIn?.time && this.checkOut?.time) {
    const diffMs = this.checkOut.time - this.checkIn.time;
    const diffHours = diffMs / (1000 * 60 * 60);

    // Subtract break time
    let breakHours = 0;
    if (this.breaks && this.breaks.length > 0) {
      breakHours = this.breaks.reduce((total, b) => total + (b.duration || 0), 0) / 60;
    }

    this.workingHours = Math.max(0, diffHours - breakHours);

    // Calculate overtime based on checkout time after 4:05 AM
    if (this.checkOut.time) {
      const checkOutDate = new Date(this.checkOut.time);
      const overtimeThreshold = new Date(checkOutDate);
      overtimeThreshold.setHours(4, 5, 0, 0); // 4:05 AM

      // If checkout is after 4:05 AM (and before noon to distinguish from evening)
      if (checkOutDate > overtimeThreshold && checkOutDate.getHours() < 12) {
        const overtimeMs = checkOutDate - overtimeThreshold;
        this.overtime = overtimeMs / (1000 * 60 * 60);
      } else {
        this.overtime = 0;
      }
    }
  }
  next();
});

module.exports = mongoose.model('Attendance', attendanceSchema);
