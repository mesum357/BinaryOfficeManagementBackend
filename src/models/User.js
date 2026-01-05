const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['employee', 'hr', 'manager', 'boss', 'admin'],
    default: 'employee'
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  // Verification status for new employee registrations
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: false  // Default to false until approved
  },
  lastLogin: {
    type: Date
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  // WebAuthn / Fingerprint authentication credentials
  webauthnCredentials: [{
    credentialId: {
      type: String,
      required: true
    },
    publicKey: {
      type: String,
      required: true
    },
    counter: {
      type: Number,
      default: 0
    },
    registeredAt: {
      type: Date,
      default: Date.now
    },
    deviceName: String,
    lastUsed: Date
  }],
  // Temporary fields for WebAuthn flows (not stored permanently)
  webauthnRegistrationChallenge: String,
  webauthnLoginChallenge: String,
  webauthnLoginUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

