const express = require('express');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { protect, isHROrAbove } = require('../middleware/auth');
const { employeeValidator } = require('../middleware/validators');

const router = express.Router();

// @route   GET /api/employees
// @desc    Get all employees
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { 
      department, 
      status, 
      search, 
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      hasAccount // Filter by employees with verified accounts
    } = req.query;
    
    const query = {};
    if (department) query.department = department;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // If hasAccount is true, filter to only employees with verified user accounts
    // Exclude HR, Boss, Manager, and Admin roles - only show regular employees
    if (hasAccount === 'true') {
      const usersWithAccounts = await User.find({
        verificationStatus: 'approved',
        role: 'employee' // Only show regular employees, not HR/Boss/Manager/Admin
      }).select('employee');
      
      const verifiedEmployeeIds = usersWithAccounts.map(u => u.employee.toString());
      query._id = { $in: verifiedEmployeeIds };
    }

    const employees = await Employee.find(query)
      .populate('department', 'name code')
      .populate('manager', 'firstName lastName employeeId')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort(sortOptions)
      .lean();

    const total = await Employee.countDocuments(query);

    res.json({
      success: true,
      data: {
        employees,
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
      message: 'Error fetching employees',
      error: error.message
    });
  }
});

// @route   GET /api/employees/directory
// @desc    Get employee directory (simplified list)
// @access  Private
router.get('/directory', protect, async (req, res) => {
  try {
    const employees = await Employee.find({ status: 'active' })
      .select('firstName lastName email phone department designation avatar employeeId')
      .populate('department', 'name')
      .sort({ firstName: 1 });

    res.json({
      success: true,
      data: { employees }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching directory',
      error: error.message
    });
  }
});

// @route   GET /api/employees/stats
// @desc    Get employee statistics
// @access  Private (HR or above)
router.get('/stats', protect, isHROrAbove, async (req, res) => {
  try {
    const totalEmployees = await Employee.countDocuments({ status: 'active' });
    const onLeave = await Employee.countDocuments({ status: 'on-leave' });
    
    const departmentStats = await Employee.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
      { $unwind: '$dept' },
      { $project: { department: '$dept.name', count: 1 } }
    ]);

    const genderStats = await Employee.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$gender', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        totalEmployees,
        onLeave,
        departmentStats,
        genderStats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stats',
      error: error.message
    });
  }
});

// @route   GET /api/employees/:id
// @desc    Get employee by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('department')
      .populate('manager', 'firstName lastName employeeId designation');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    res.json({
      success: true,
      data: { employee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching employee',
      error: error.message
    });
  }
});

// @route   POST /api/employees
// @desc    Create new employee
// @access  Private (HR or above)
router.post('/', protect, isHROrAbove, employeeValidator, async (req, res) => {
  try {
    const employee = await Employee.create(req.body);

    // Create user account for employee
    if (req.body.createUser) {
      await User.create({
        email: employee.email,
        password: req.body.password || 'password123', // Default password
        role: 'employee',
        employee: employee._id
      });
    }

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      data: { employee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating employee',
      error: error.message
    });
  }
});

// @route   PUT /api/employees/:id
// @desc    Update employee
// @access  Private (HR or above, or self for limited fields)
router.put('/:id', protect, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Check permissions
    const isOwner = req.user.employee && req.user.employee.toString() === req.params.id;
    const isHR = ['hr', 'manager', 'boss', 'admin'].includes(req.user.role);

    if (!isOwner && !isHR) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this employee'
      });
    }

    // If not HR, limit updateable fields
    let updateData = req.body;
    if (!isHR) {
      const { phone, address, emergencyContact, avatar } = req.body;
      updateData = { phone, address, emergencyContact, avatar };
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('department');

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: { employee: updatedEmployee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating employee',
      error: error.message
    });
  }
});

// @route   PUT /api/employees/:id/freeze
// @desc    Freeze/unfreeze employee account
// @access  Private (HR or above)
router.put('/:id/freeze', protect, isHROrAbove, async (req, res) => {
  try {
    const { isActive } = req.body;
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Update user account isActive status
    const user = await User.findOneAndUpdate(
      { employee: req.params.id },
      { isActive: isActive !== undefined ? isActive : false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account not found for this employee'
      });
    }

    res.json({
      success: true,
      message: isActive ? 'Employee account unfrozen successfully' : 'Employee account frozen successfully',
      data: { user, employee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error freezing/unfreezing employee',
      error: error.message
    });
  }
});

// @route   PUT /api/employees/:id/terminate
// @desc    Terminate employee (set status to terminated)
// @access  Private (HR or above)
router.put('/:id/terminate', protect, isHROrAbove, async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { status: 'terminated' },
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Deactivate user account
    await User.findOneAndUpdate(
      { employee: req.params.id },
      { isActive: false }
    );

    res.json({
      success: true,
      message: 'Employee terminated successfully',
      data: { employee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error terminating employee',
      error: error.message
    });
  }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee permanently
// @access  Private (HR or above)
router.delete('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Delete associated user account
    await User.findOneAndDelete({ employee: req.params.id });

    // Delete employee record
    await Employee.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting employee',
      error: error.message
    });
  }
});

module.exports = router;

