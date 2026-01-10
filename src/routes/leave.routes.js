const express = require('express');
const Leave = require('../models/Leave');
const LeavePolicy = require('../models/LeavePolicy');
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
// @desc    Get leave balance based on HR policies
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

    // Fetch all active leave policies set by HR
    const policies = await LeavePolicy.find({ isActive: true }).lean();
    
    // Create a map of leave types to monthly limits
    const policyMap = {};
    policies.forEach(policy => {
      policyMap[policy.leaveType] = policy.monthlyLimit || 0;
    });

    // Calculate used leaves for the current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    const usedLeaves = await Leave.aggregate([
      {
        $match: {
          employee: req.user.employee,
          status: 'approved',
          startDate: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: '$leaveType',
          totalDays: { $sum: '$totalDays' }
        }
      }
    ]);

    // Create a map of used leaves by type
    const usedMap = {};
    usedLeaves.forEach(item => {
      usedMap[item._id] = item.totalDays;
    });

    // Build balance object based on policies
    const balance = {};
    const used = {};
    const remaining = {};
    const totals = {};

    // Map common leave types
    const leaveTypes = ['annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other'];
    
    leaveTypes.forEach(type => {
      const monthlyLimit = policyMap[type] || 0;
      const usedDays = usedMap[type] || 0;
      const remainingDays = Math.max(0, monthlyLimit - usedDays);
      
      // For backward compatibility, maintain the old structure but use policy values
      balance[type] = monthlyLimit; // This represents the total/limit
      used[type] = usedDays;
      remaining[type] = remainingDays;
      totals[type] = monthlyLimit;
    });

    res.json({
      success: true,
      data: { 
        balance: balance, // Total/limit from policies
        used: used, // Used this month
        remaining: remaining, // Remaining this month
        totals: totals, // Same as balance for backward compatibility
        policies: policies.map(p => ({ leaveType: p.leaveType, monthlyLimit: p.monthlyLimit }))
      }
    });
  } catch (error) {
    console.error('Error fetching leave balance:', error);
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

// @route   POST /api/leaves/policy
// @desc    Create or update leave policy
// @access  Private (HR or above)
router.post('/policy', protect, isHROrAbove, async (req, res) => {
  try {
    const { leaveType, monthlyLimit, description, isActive } = req.body;

    if (!leaveType || monthlyLimit === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Leave type and monthly limit are required'
      });
    }

    // Check if policy exists
    let policy = await LeavePolicy.findOne({ leaveType });

    if (policy) {
      // Update existing policy
      policy.monthlyLimit = monthlyLimit;
      policy.description = description || policy.description;
      policy.isActive = isActive !== undefined ? isActive : policy.isActive;
      policy.updatedBy = req.user._id;
      await policy.save();
    } else {
      // Create new policy
      policy = await LeavePolicy.create({
        leaveType,
        monthlyLimit,
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
    const { monthlyLimit, description, isActive } = req.body;

    const policy = await LeavePolicy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    if (monthlyLimit !== undefined) policy.monthlyLimit = monthlyLimit;
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

module.exports = router;

