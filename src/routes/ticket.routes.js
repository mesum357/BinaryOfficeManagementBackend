const express = require('express');
const Ticket = require('../models/Ticket');
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

    const ticket = await Ticket.create({
      employee: req.user.employee?._id || req.user.employee,
      subject,
      category,
      priority: priority || 'medium',
      description,
      status: 'open'
    });

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: { ticket }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating ticket',
      error: error.message
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
    const tickets = await Ticket.find({ employee: req.user.employee?._id || req.user.employee })
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: { tickets }
    });
  } catch (error) {
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
