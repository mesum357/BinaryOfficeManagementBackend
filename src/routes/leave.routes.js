const express = require('express');
const Leave = require('../models/Leave');
const LeavePolicy = require('../models/LeavePolicy');
const Employee = require('../models/Employee');
const { protect, isHROrAbove } = require('../middleware/auth');
const { leaveValidator } = require('../middleware/validators');
const { leaveUpload } = require('../config/upload');

const router = express.Router();

// @route   GET /api/leaves
// @desc    Get all leave requests
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const {
      employee,
      status,
      leaveType,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Non-HR users can only see their own leaves
    if (!['hr', 'manager', 'boss', 'admin'].includes(req.user.role)) {
      query.employee = req.user.employee;
    } else if (employee) {
      query.employee = employee;
    }

    if (status) query.status = status;
    if (leaveType) query.leaveType = leaveType;
    if (startDate) query.startDate = { $gte: new Date(startDate) };
    if (endDate) query.endDate = { $lte: new Date(endDate) };

    const leaves = await Leave.find(query)
      .populate('employee', 'firstName lastName employeeId department')
      .populate('reviewedBy', 'email')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .lean();

    const total = await Leave.countDocuments(query);

    res.json({
      success: true,
      data: {
        leaves,
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
      message: 'Error fetching leaves',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/my
// @desc    Get current user's leave requests
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    const leaves = await Leave.find({ employee: req.user.employee })
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    const employee = await Employee.findById(req.user.employee)
      .select('leaveBalance');

    res.json({
      success: true,
      data: {
        leaves,
        leaveBalance: employee?.leaveBalance
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leaves',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/pending
// @desc    Get pending leave requests
// @access  Private (HR or above)
router.get('/pending', protect, isHROrAbove, async (req, res) => {
  try {
    const leaves = await Leave.find({ status: 'pending' })
      .populate('employee', 'firstName lastName employeeId department designation')
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name' }
      })
      .select('-__v')
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      success: true,
      data: { leaves }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching pending leaves',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/balance
// @desc    Get leave balance (simplified - showing only used days)
// @access  Private
router.get('/balance', protect, async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    const mongoose = require('mongoose');
    const employeeId = req.user.employee?._id || req.user.employee;
    const employeeObjectId = mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : employeeId;

    const usedLeaves = await Leave.aggregate([
      {
        $match: {
          employee: employeeObjectId,
          status: 'approved',
          $or: [
            { startDate: { $gte: startOfYear, $lte: endOfYear } },
            { endDate: { $gte: startOfYear, $lte: endOfYear } }
          ]
        }
      },
      {
        $group: {
          _id: '$leaveType',
          totalDays: { $sum: '$totalDays' }
        }
      }
    ]);

    const usedMap = {};
    usedLeaves.forEach(item => {
      usedMap[item._id] = item.totalDays;
    });

    res.json({
      success: true,
      data: {
        used: usedMap,
        message: 'Leave balance logic simplified. Showing used days only.'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leave balance',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/policy
// @desc    Get all leave policies
// @access  Private (HR or above)
router.get('/policy', protect, isHROrAbove, async (req, res) => {
  try {
    console.log('[Leave Routes] Fetching leave policies...');

    // Check if LeavePolicy model is available
    if (!LeavePolicy) {
      console.error('[Leave Routes] LeavePolicy model not found');
      return res.status(500).json({
        success: false,
        message: 'LeavePolicy model not available'
      });
    }

    const policies = await LeavePolicy.find({ isActive: true })
      .populate('createdBy', 'email')
      .populate('updatedBy', 'email')
      .sort({ leaveType: 1 });

    console.log('[Leave Routes] Found policies:', policies?.length || 0);

    res.json({
      success: true,
      data: { policies: policies || [] }
    });
  } catch (error) {
    console.error('[Leave Routes] Error fetching leave policies:', error);
    console.error('[Leave Routes] Error name:', error.name);
    console.error('[Leave Routes] Error message:', error.message);
    if (error.stack) {
      console.error('[Leave Routes] Error stack:', error.stack);
    }

    res.status(500).json({
      success: false,
      message: 'Error fetching leave policies',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        stack: error.stack
      } : undefined
    });
  }
});

// @route   GET /api/leaves/policy/:leaveType
// @desc    Get leave policy by type
// @access  Private (HR or above)
router.get('/policy/:leaveType', protect, isHROrAbove, async (req, res) => {
  try {
    const policy = await LeavePolicy.findOne({
      leaveType: req.params.leaveType,
      isActive: true
    });

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    res.json({
      success: true,
      data: { policy }
    });
  } catch (error) {
    console.error('[Leave Routes] Error fetching leave policy:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching leave policy',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/:id
// @desc    Get leave by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId department')
      .populate('reviewedBy', 'email');

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    res.json({
      success: true,
      data: { leave }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leave',
      error: error.message
    });
  }
});

// @route   POST /api/leaves
// @desc    Create leave request
// @access  Private
router.post('/', protect, leaveUpload.single('image'), leaveValidator, async (req, res) => {
  try {
    const leaveData = { ...req.body };

    // Explicitly parse dates and calculate totalDays
    // This fixes the 500 error where totalDays was missing or invalid during validation
    const start = new Date(leaveData.startDate);
    const end = new Date(leaveData.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start or end date'
      });
    }

    const diffTime = Math.abs(end - start);
    leaveData.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // If an image was uploaded, add it to attachments
    if (req.file) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      leaveData.attachments = [{
        name: req.file.originalname,
        url: `${baseUrl}/uploads/leaves/${req.file.filename}`
      }];
    }

    const leave = await Leave.create({
      ...leaveData,
      employee: req.user.employee
    });

    // Emit socket notification for new leave request
    const io = req.app.get('io');
    if (io) {
      // Find employee details for the notification
      const employee = await Employee.findById(req.user.employee);
      io.emit('newLeaveRequest', {
        _id: leave._id,
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate,
        totalDays: leave.totalDays,
        employee: {
          firstName: employee?.firstName || 'Unknown',
          lastName: employee?.lastName || 'Employee'
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: { leave }
    });
  } catch (error) {
    console.error('[Leave Create Error]:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating leave request',
      error: error.message
    });
  }
});

// @route   PUT /api/leaves/:id/approve
// @desc    Approve leave request
// @access  Private (HR or above)
router.put('/:id/approve', protect, isHROrAbove, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Leave request has already been processed'
      });
    }

    // Approve the leave - balance is calculated dynamically from approved leaves
    leave.status = 'approved';
    leave.reviewedBy = req.user._id;
    leave.reviewedOn = new Date();
    leave.reviewerComments = req.body.comments;
    await leave.save();

    console.log(`[Leave Approval] Approved ${leave.totalDays} days of ${leave.leaveType} leave for employee ${leave.employee}`);

    res.json({
      success: true,
      message: 'Leave approved successfully',
      data: { leave }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error approving leave',
      error: error.message
    });
  }
});

// @route   PUT /api/leaves/:id/reject
// @desc    Reject leave request
// @access  Private (HR or above)
router.put('/:id/reject', protect, isHROrAbove, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Leave request has already been processed'
      });
    }

    leave.status = 'rejected';
    leave.reviewedBy = req.user._id;
    leave.reviewedOn = new Date();
    leave.reviewerComments = req.body.comments || req.body.reason;
    await leave.save();

    res.json({
      success: true,
      message: 'Leave rejected',
      data: { leave }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting leave',
      error: error.message
    });
  }
});

// @route   PUT /api/leaves/:id/cancel
// @desc    Cancel leave request
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    // Check ownership
    const userEmployeeId = req.user.employee && (req.user.employee._id || req.user.employee).toString();
    if (leave.employee.toString() !== userEmployeeId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this leave'
      });
    }

    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel this leave request'
      });
    }

    // If was approved, restore leave balance
    if (leave.status === 'approved') {
      const leaveTypeMap = {
        annual: 'annual',
        sick: 'sick',
        casual: 'casual'
      };

      if (leaveTypeMap[leave.leaveType]) {
        await Employee.findByIdAndUpdate(leave.employee, {
          $inc: { [`leaveBalance.${leaveTypeMap[leave.leaveType]}`]: leave.totalDays }
        });
      }
    }

    leave.status = 'cancelled';
    await leave.save();

    res.json({
      success: true,
      message: 'Leave cancelled successfully',
      data: { leave }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error cancelling leave',
      error: error.message
    });
  }
});

// @route   POST /api/leaves/policy
// @desc    Create or update leave policy
// @access  Private (HR or above)
router.post('/policy', protect, isHROrAbove, async (req, res) => {
  try {
    const { leaveType, yearlyLimit, description, isActive } = req.body;

    if (!leaveType || yearlyLimit === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Leave type and yearly limit are required'
      });
    }

    // Check if policy exists
    let policy = await LeavePolicy.findOne({ leaveType });

    if (policy) {
      // Update existing policy
      policy.yearlyLimit = yearlyLimit;
      policy.description = description || policy.description;
      policy.isActive = isActive !== undefined ? isActive : policy.isActive;
      policy.updatedBy = req.user._id;
      await policy.save();
    } else {
      // Create new policy
      policy = await LeavePolicy.create({
        leaveType,
        yearlyLimit,
        description: description || '',
        isActive: isActive !== undefined ? isActive : true,
        createdBy: req.user._id,
        updatedBy: req.user._id
      });
    }

    res.json({
      success: true,
      message: 'Leave policy saved successfully',
      data: { policy }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Leave policy for this type already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error saving leave policy',
      error: error.message
    });
  }
});

// @route   PUT /api/leaves/policy/:id
// @desc    Update leave policy
// @access  Private (HR or above)
router.put('/policy/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const { yearlyLimit, description, isActive } = req.body;

    const policy = await LeavePolicy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    if (yearlyLimit !== undefined) policy.yearlyLimit = yearlyLimit;
    if (description !== undefined) policy.description = description;
    if (isActive !== undefined) policy.isActive = isActive;
    policy.updatedBy = req.user._id;

    await policy.save();

    res.json({
      success: true,
      message: 'Leave policy updated successfully',
      data: { policy }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating leave policy',
      error: error.message
    });
  }
});

// @route   DELETE /api/leaves/policy/:id
// @desc    Delete leave policy (soft delete)
// @access  Private (HR or above)
router.delete('/policy/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const policy = await LeavePolicy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    policy.isActive = false;
    policy.updatedBy = req.user._id;
    await policy.save();

    res.json({
      success: true,
      message: 'Leave policy deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting leave policy',
      error: error.message
    });
  }
});

// @route   GET /api/leaves/unread-count
// @desc    Get count of unread leave requests
// @access  Private (Managers)
router.get('/unread-count', protect, isHROrAbove, async (req, res) => {
  try {
    const unreadCount = await Leave.countDocuments({
      status: 'pending',
      isRead: false
    });

    res.json({
      success: true,
      data: { unreadCount }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching unread count',
      error: error.message
    });
  }
});

// @route   PUT /api/leaves/:id/mark-read
// @desc    Mark a leave request as read
// @access  Private (Managers)
router.put('/:id/mark-read', protect, isHROrAbove, async (req, res) => {
  try {
    const leave = await Leave.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    res.json({
      success: true,
      message: 'Leave request marked as read',
      data: { leave }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error marking leave as read',
      error: error.message
    });
  }
});

module.exports = router;

