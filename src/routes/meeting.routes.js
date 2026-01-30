const express = require('express');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { protect, isHROrAbove } = require('../middleware/auth');
const { meetingValidator } = require('../middleware/validators');

const router = express.Router();

// @route   GET /api/meetings
// @desc    Get all meetings
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Filter meetings where user is organizer or attendee
    if (!['boss', 'admin', 'hr'].includes(req.user.role)) {
      const userEmployeeId = req.user.employee?._id || req.user.employee;
      query.$or = [
        { organizer: req.user._id },
        { 'attendees.employee': userEmployeeId }
      ];
    }

    if (status) query.status = status;
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const meetings = await Meeting.find(query)
      .populate('organizer', 'email')
      .populate('attendees.employee', 'firstName lastName employeeId')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ startTime: 1 })
      .lean();

    const total = await Meeting.countDocuments(query);

    res.json({
      success: true,
      data: {
        meetings,
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
      message: 'Error fetching meetings',
      error: error.message
    });
  }
});

// @route   GET /api/meetings/upcoming
// @desc    Get upcoming meetings
// @access  Private
router.get('/upcoming', protect, async (req, res) => {
  try {
    const now = new Date();

    const query = {
      startTime: { $gte: now },
      status: { $in: ['scheduled', 'in-progress'] }
    };

    if (!['boss', 'admin', 'hr'].includes(req.user.role)) {
      const userEmployeeId = req.user.employee?._id || req.user.employee;
      query.$or = [
        { organizer: req.user._id },
        { 'attendees.employee': userEmployeeId }
      ];
    }

    const meetings = await Meeting.find(query)
      .populate('organizer', 'email')
      .populate('attendees.employee', 'firstName lastName')
      .select('-__v')
      .sort({ startTime: 1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: { meetings }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching upcoming meetings',
      error: error.message
    });
  }
});

// @route   GET /api/meetings/today
// @desc    Get today's meetings
// @access  Private
router.get('/today', protect, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const query = {
      startTime: { $gte: startOfDay, $lte: endOfDay }
    };

    if (!['boss', 'admin', 'hr'].includes(req.user.role)) {
      const userEmployeeId = req.user.employee?._id || req.user.employee;
      query.$or = [
        { organizer: req.user._id },
        { 'attendees.employee': userEmployeeId }
      ];
    }

    const meetings = await Meeting.find(query)
      .populate('organizer', 'email')
      .populate('attendees.employee', 'firstName lastName')
      .select('-__v')
      .sort({ startTime: 1 })
      .lean();

    res.json({
      success: true,
      data: { meetings }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s meetings',
      error: error.message
    });
  }
});

// @route   GET /api/meetings/:id
// @desc    Get meeting by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id)
      .populate('organizer', 'email')
      .populate('attendees.employee', 'firstName lastName employeeId email')
      .populate('agenda.presenter', 'firstName lastName');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    res.json({
      success: true,
      data: { meeting }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching meeting',
      error: error.message
    });
  }
});

// @route   POST /api/meetings
// @desc    Create meeting
// @access  Private (HR or above)
router.post('/', protect, isHROrAbove, meetingValidator, async (req, res) => {
  try {
    const meeting = await Meeting.create({
      ...req.body,
      organizer: req.user._id
    });

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io && req.body.attendees) {
      // Find all users associated with these employees
      const employeeIds = req.body.attendees.map(a => a.employee);
      User.find({ employee: { $in: employeeIds } }).select('_id employee').then(users => {
        users.forEach(user => {
          io.to(user._id.toString()).emit('newMeeting', {
            id: meeting._id,
            title: meeting.title,
            startTime: meeting.startTime
          });
        });
      });
    }

    res.status(201).json({
      success: true,
      message: 'Meeting scheduled successfully',
      data: { meeting }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating meeting',
      error: error.message
    });
  }
});

// @route   PUT /api/meetings/:id
// @desc    Update meeting
// @access  Private (Organizer or Manager+)
router.put('/:id', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if user is organizer or manager+
    const isOrganizer = meeting.organizer.toString() === req.user._id.toString();
    const isManager = ['manager', 'boss', 'admin'].includes(req.user.role);

    if (!isOrganizer && !isManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this meeting'
      });
    }

    const updatedMeeting = await Meeting.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('organizer', 'email')
      .populate('attendees.employee', 'firstName lastName');

    res.json({
      success: true,
      message: 'Meeting updated successfully',
      data: { meeting: updatedMeeting }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating meeting',
      error: error.message
    });
  }
});

// @route   PUT /api/meetings/:id/respond
// @desc    Respond to meeting invitation
// @access  Private
router.put('/:id/respond', protect, async (req, res) => {
  try {
    const { response } = req.body; // accepted, declined, tentative

    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    const userEmployeeId = req.user.employee?._id?.toString() || req.user.employee?.toString();
    const attendeeIndex = meeting.attendees.findIndex(
      a => a.employee.toString() === userEmployeeId
    );

    if (attendeeIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'You are not invited to this meeting'
      });
    }

    meeting.attendees[attendeeIndex].status = response;
    meeting.attendees[attendeeIndex].responseTime = new Date();
    await meeting.save();

    res.json({
      success: true,
      message: `Meeting ${response}`,
      data: { meeting }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error responding to meeting',
      error: error.message
    });
  }
});

// @route   DELETE /api/meetings/:id
// @desc    Delete meeting
// @access  Private (Organizer or Manager+)
router.delete('/:id', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    const isOrganizer = meeting.organizer.toString() === req.user._id.toString();
    const isManager = ['manager', 'boss', 'admin'].includes(req.user.role);

    if (!isOrganizer && !isManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this meeting'
      });
    }

    await Meeting.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Meeting deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting meeting',
      error: error.message
    });
  }
});

module.exports = router;

