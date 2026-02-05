const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  subject: {
    type: String,
    required: [true, 'Ticket subject is required'],
    trim: true
  },
  category: {
    type: String,
    enum: ['IT Support', 'HR Inquiry', 'Payroll Issue', 'Leave Request', 'Facilities', 'Equipment Request', 'Access & Permissions', 'Other'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  description: {
    type: String,
    required: [true, 'Ticket description is required']
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: {
    type: Date
  },
  resolutionNotes: {
    type: String
  },
  attachments: [{
    name: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Generate ticket number before saving
ticketSchema.pre('save', async function(next) {
  try {
    if (!this.ticketNumber) {
      // Use this.constructor to avoid circular dependency issues
      const TicketModel = this.constructor;
      
      // Find the highest ticket number
      const lastTicket = await TicketModel.findOne().sort({ ticketNumber: -1 }).lean();
      let ticketNum = 1;
      
      if (lastTicket && lastTicket.ticketNumber) {
        const lastNum = parseInt(lastTicket.ticketNumber.replace('TKT-', ''), 10);
        if (!isNaN(lastNum) && lastNum > 0) {
          ticketNum = lastNum + 1;
        }
      }
      
      this.ticketNumber = `TKT-${String(ticketNum).padStart(6, '0')}`;
    }
    next();
  } catch (error) {
    console.error('Error generating ticket number:', error);
    next(error);
  }
});

// Index for faster queries
ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ employee: 1, createdAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
