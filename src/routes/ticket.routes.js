const express = require('express');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/tickets
// @desc    Create a new ticket
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { subject, category, priority, description } = req.body;

    if (!subject || !category || !description) {
      return res.status(400).json({
        success: false,
        message: 'Subject, category, and description are required'
      });
    }

    // Get employee ID - handle both populated and non-populated cases
    let employeeId = null;
    if (req.user.employee) {
      // If populated, use _id; if not populated, use the ObjectId directly
      employeeId = req.user.employee._id || req.user.employee;
      // Convert to ObjectId if it's a string
      if (typeof employeeId === 'string') {
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid employee ID format'
          });
        }
        employeeId = new mongoose.Types.ObjectId(employeeId);
      }
    }

    // Check if employee exists (required for ticket creation)
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee record not found. Please contact HR to associate an employee profile with your account.'
      });
    }

    // Validate that employeeId is a valid ObjectId (double-check)
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee ID format'
      });
    }

    // Verify employee exists in database
    const employeeExists = await Employee.findById(employeeId);
    if (!employeeExists) {
      return res.status(400).json({
        success: false,
        message: 'Employee record not found in database'
      });
    }

    // Validate category
    const validCategories = ['IT Support', 'HR Inquiry', 'Payroll Issue', 'Leave Request', 'Facilities', 'Equipment Request', 'Access & Permissions', 'Other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category'
      });
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const finalPriority = priority || 'medium';
    if (!validPriorities.includes(finalPriority)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid priority'
      });
    }

    // Generate ticket number with retry logic for race conditions
    let ticket;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        const lastTicket = await Ticket.findOne().sort({ ticketNumber: -1 }).lean();
        let ticketNum = 1;

        if (lastTicket && lastTicket.ticketNumber) {
          const lastNum = parseInt(lastTicket.ticketNumber.replace('TKT-', ''), 10);
          if (!isNaN(lastNum) && lastNum > 0) {
            ticketNum = lastNum + 1 + attempts; // Add attempts to avoid collisions
          }
        } else {
          ticketNum = 1 + attempts;
        }

        const ticketNumber = `TKT-${String(ticketNum).padStart(6, '0')}`;

        ticket = await Ticket.create({
          ticketNumber,
          employee: employeeId,
          subject: subject.trim(),
          category,
          priority: finalPriority,
          description: description.trim(),
          status: 'open'
        });

        // Successfully created, break out of retry loop
        break;
      } catch (createError) {
        attempts++;
        // If it's a duplicate key error (E11000), retry with different number
        if (createError.code === 11000 && attempts < maxAttempts) {
          continue;
        }
        // For other errors or max attempts reached, throw
        throw createError;
      }
    }

    if (!ticket) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create ticket after multiple attempts'
      });
    }

    // Populate employee details for response
    await ticket.populate({
      path: 'employee',
      select: 'firstName lastName employeeId department designation',
      populate: { path: 'department', select: 'name' }
    });

    // Emit socket event to management users
    const io = req.app.get('io');
    if (io) {
      // Find all users with management/HR roles
      const managementUsers = await User.find({
        role: { $in: ['hr', 'manager', 'boss', 'admin'] }
      }).select('_id');

      managementUsers.forEach(mUser => {
        io.to(mUser._id.toString()).emit('newTicket', {
          id: ticket._id,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          employee: {
            firstName: ticket.employee.firstName,
            lastName: ticket.employee.lastName
          }
        });
      });
    }

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: { ticket }
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    console.error('Error stack:', error.stack);

    // Handle specific MongoDB errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: Object.values(error.errors).map(err => err.message).join(', ')
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate ticket number. Please try again.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating ticket',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @route   GET /api/tickets
// @desc    Get all tickets (HR can see all, employees see only their own)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { status, category, priority, page = 1, limit = 20 } = req.query;

    const query = {};

    // Non-HR users can only see their own tickets
    if (!['hr', 'manager', 'boss', 'admin'].includes(req.user.role)) {
      query.employee = req.user.employee?._id || req.user.employee;
    }

    if (status) query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;

    const tickets = await Ticket.find(query)
      .populate('employee', 'firstName lastName employeeId department designation')
      .populate('resolvedBy', 'email')
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name' }
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Ticket.countDocuments(query);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching tickets',
      error: error.message
    });
  }
});

// @route   GET /api/tickets/my
// @desc    Get current user's tickets
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    // Get employee ID - handle both populated and non-populated cases
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    // If no employee record, return empty array
    if (!employeeId) {
      return res.json({
        success: true,
        data: { tickets: [] }
      });
    }

    const tickets = await Ticket.find({ employee: employeeId })
      .populate('employee', 'firstName lastName employeeId department designation')
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name' }
      })
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: { tickets }
    });
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tickets',
      error: error.message
    });
  }
});

// @route   GET /api/tickets/stats
// @desc    Get ticket statistics
// @access  Private (HR or above)
router.get('/stats', protect, isHROrAbove, async (req, res) => {
  try {
    const totalTickets = await Ticket.countDocuments();
    const openTickets = await Ticket.countDocuments({ status: 'open' });
    const inProgressTickets = await Ticket.countDocuments({ status: 'in-progress' });
    const resolvedTickets = await Ticket.countDocuments({ status: 'resolved' });

    // Get latest ticket number for display
    const latestTicket = await Ticket.findOne().sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        total: totalTickets,
        open: openTickets,
        inProgress: inProgressTickets,
        resolved: resolvedTickets,
        latestTicketNumber: latestTicket?.ticketNumber || null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching ticket stats',
      error: error.message
    });
  }
});

// @route   GET /api/tickets/:id
// @desc    Get ticket by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId department designation')
      .populate('resolvedBy', 'email')
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name' }
      });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check if user has access to this ticket
    const userEmployeeId = req.user.employee?._id?.toString() || req.user.employee?.toString();
    if (!['hr', 'manager', 'boss', 'admin'].includes(req.user.role) &&
      ticket.employee._id.toString() !== userEmployeeId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this ticket'
      });
    }

    res.json({
      success: true,
      data: { ticket }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching ticket',
      error: error.message
    });
  }
});

// @route   PUT /api/tickets/:id/resolve
// @desc    Resolve a ticket
// @access  Private (HR or above)
router.put('/:id/resolve', protect, isHROrAbove, async (req, res) => {
  try {
    const { resolutionNotes } = req.body;

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Ticket is already resolved'
      });
    }

    ticket.status = 'resolved';
    ticket.resolvedBy = req.user._id;
    ticket.resolvedAt = new Date();
    ticket.resolutionNotes = resolutionNotes || '';

    await ticket.save();

    res.json({
      success: true,
      message: 'Ticket resolved successfully',
      data: { ticket }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resolving ticket',
      error: error.message
    });
  }
});

// @route   PUT /api/tickets/:id/status
// @desc    Update ticket status
// @access  Private (HR or above)
router.put('/:id/status', protect, isHROrAbove, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['open', 'in-progress', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    ticket.status = status;

    if (status === 'resolved' && !ticket.resolvedAt) {
      ticket.resolvedBy = req.user._id;
      ticket.resolvedAt = new Date();
    }

    await ticket.save();

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      data: { ticket }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating ticket status',
      error: error.message
    });
  }
});

module.exports = router;
