const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true
  },
  description: {
    type: String
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }],
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'under-review', 'completed', 'cancelled', 'on-hold'],
    default: 'pending'
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  completedDate: {
    type: Date
  },
  estimatedHours: {
    type: Number
  },
  actualHours: {
    type: Number
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  category: {
    type: String,
    enum: ['development', 'design', 'testing', 'documentation', 'meeting', 'review', 'other'],
    default: 'other'
  },
  tags: [String],
  attachments: [{
    name: String,
    url: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  submissionDescription: {
    type: String,
    default: ''
  },
  submissionDate: {
    type: Date
  },
  subtasks: [{
    title: String,
    isCompleted: {
      type: Boolean,
      default: false
    },
    completedAt: Date
  }],
  parentTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  }
}, {
  timestamps: true
});

// Index for faster queries
taskSchema.index({ status: 1, dueDate: 1 });
taskSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model('Task', taskSchema);

