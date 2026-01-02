const express = require('express');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const { protect, isHROrAbove } = require('../middleware/auth');
const { leaveValidator } = require('../middleware/validators');

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
      .sort({ createdAt: -1 });

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
      .sort({ createdAt: -1 });

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
      .sort({ createdAt: 1 });

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
// @desc    Get leave balance
// @access  Private
router.get('/balance', protect, async (req, res) => {
  try {
    const employee = await Employee.findById(req.user.employee)
      .select('leaveBalance');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Calculate used leaves this year
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);
    const usedLeaves = await Leave.aggregate([
      {
        $match: {
          employee: req.user.employee,
          status: 'approved',
          startDate: { $gte: startOfYear }
        }
      },
      {
        $group: {
          _id: '$leaveType',
          totalDays: { $sum: '$totalDays' }
        }
      }
    ]);

    res.json({
      success: true,
      data: { 
        balance: employee.leaveBalance,
        used: usedLeaves
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
router.post('/', protect, leaveValidator, async (req, res) => {
  try {
    const leave = await Leave.create({
      ...req.body,
      employee: req.user.employee
    });

    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: { leave }
    });
  } catch (error) {
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

    leave.status = 'approved';
    leave.reviewedBy = req.user._id;
    leave.reviewedOn = new Date();
    leave.reviewerComments = req.body.comments;
    await leave.save();

    // Deduct from leave balance
    const leaveTypeMap = {
      annual: 'annual',
      sick: 'sick',
      casual: 'casual'
    };

    if (leaveTypeMap[leave.leaveType]) {
      await Employee.findByIdAndUpdate(leave.employee, {
        $inc: { [`leaveBalance.${leaveTypeMap[leave.leaveType]}`]: -leave.totalDays }
      });
    }

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
    if (leave.employee.toString() !== req.user.employee.toString()) {
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

module.exports = router;

