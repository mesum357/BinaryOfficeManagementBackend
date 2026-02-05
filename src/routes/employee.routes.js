const express = require('express');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { protect, isHROrAbove } = require('../middleware/auth');
const { employeeValidator } = require('../middleware/validators');
const { documentUpload } = require('../config/upload');

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

    // Get isActive status for each employee
    const users = await User.find({ employee: { $in: employees.map(e => e._id) } }).select('employee isActive');
    const userMap = users.reduce((acc, user) => {
      acc[user.employee.toString()] = user.isActive;
      return acc;
    }, {});

    const employeesWithAccountStatus = employees.map(emp => ({
      ...emp,
      isActive: userMap[emp._id.toString()] !== undefined ? userMap[emp._id.toString()] : false
    }));

    res.json({
      success: true,
      data: {
        employees: employeesWithAccountStatus,
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
    // Only count real employees (those with approved accounts in employee portal)
    const usersWithEmployeeAccounts = await User.find({
      verificationStatus: 'approved',
      role: 'employee'
    }).select('employee');

    const verifiedEmployeeIds = usersWithEmployeeAccounts
      .map(u => u.employee)
      .filter(Boolean);

    const totalEmployees = await Employee.countDocuments({
      _id: { $in: verifiedEmployeeIds },
      status: 'active'
    });
    const onLeave = await Employee.countDocuments({
      _id: { $in: verifiedEmployeeIds },
      status: 'on-leave'
    });

    const departmentStats = await Employee.aggregate([
      { $match: { _id: { $in: verifiedEmployeeIds }, status: 'active' } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
      { $unwind: '$dept' },
      { $project: { department: '$dept.name', count: 1 } }
    ]);

    const genderStats = await Employee.aggregate([
      { $match: { _id: { $in: verifiedEmployeeIds }, status: 'active' } },
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

// @route   GET /api/employees/with-status
// @desc    Get employees with real-time attendance status
// @access  Private (HR or above)
router.get('/with-status', protect, isHROrAbove, async (req, res) => {
  try {
    const { department, search } = req.query;

    const query = {};
    if (department && department !== 'all') query.department = department;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    // Only get active employees who have verified accounts
    const users = await User.find({ verificationStatus: 'approved', role: 'employee' }).select('employee');
    const employeeIds = users.map(u => u.employee);

    query._id = { $in: employeeIds };
    query.status = { $in: ['active', 'on-leave', 'terminated'] };

    const employees = await Employee.find(query)
      .populate('department', 'name code')
      .populate('manager', 'firstName lastName')
      .sort({ firstName: 1 })
      .lean();

    // Get today's attendance for these employees
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const Attendance = require('../models/Attendance');
    const attendanceRecords = await Attendance.find({
      employee: { $in: employees.map(e => e._id) },
      date: { $gte: today, $lt: tomorrow }
    });

    // Get isActive status for these employees
    const usersForStatus = await User.find({ employee: { $in: employees.map(e => e._id) } }).select('employee isActive');
    const userStatusMap = usersForStatus.reduce((acc, user) => {
      acc[user.employee.toString()] = user.isActive;
      return acc;
    }, {});

    // Map attendance status and isActive status to employees
    const employeesWithStatus = employees.map(emp => {
      const attendance = attendanceRecords.find(a => a.employee.toString() === emp._id.toString());

      let realTimeStatus = 'inactive'; // Default (not clocked in)

      if (attendance) {
        if (attendance.checkOut && attendance.checkOut.time) {
          realTimeStatus = 'clocked-out';
        } else if (attendance.checkIn && attendance.checkIn.time) {
          // Check if on break
          const lastBreak = attendance.breaks && attendance.breaks.length > 0
            ? attendance.breaks[attendance.breaks.length - 1]
            : null;

          if (lastBreak && !lastBreak.endTime) {
            realTimeStatus = 'on-break';
          } else {
            realTimeStatus = 'clocked-in';
          }
        }
      }

      return {
        ...emp,
        attendanceStatus: realTimeStatus,
        isActive: userStatusMap[emp._id.toString()] !== undefined ? userStatusMap[emp._id.toString()] : false
      };
    });

    res.json({
      success: true,
      data: { employees: employeesWithStatus }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching employee status',
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
    const isOwner = req.user.employee && (req.user.employee._id || req.user.employee).toString() === req.params.id;
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
      const { phone, address, emergencyContact, avatar, firstName, lastName, skills, expertise } = req.body;
      updateData = { phone, address, emergencyContact, avatar, firstName, lastName, skills, expertise };
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

// @route   PUT /api/employees/:id/unterminate
// @desc    Unterminate employee (set status to active)
// @access  Private (HR or above)
router.put('/:id/unterminate', protect, isHROrAbove, async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { status: 'active' },
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Reactivate user account
    await User.findOneAndUpdate(
      { employee: req.params.id },
      { isActive: true }
    );

    res.json({
      success: true,
      message: 'Employee unterminated successfully',
      data: { employee }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error unterminating employee',
      error: error.message
    });
  }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee permanently with cascade delete of all related data
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

    const employeeId = req.params.id;

    // Import all related models for cascade delete
    const Attendance = require('../models/Attendance');
    const Task = require('../models/Task');
    const Ticket = require('../models/Ticket');
    const Leave = require('../models/Leave');
    const Report = require('../models/Report');
    const Chat = require('../models/Chat');
    const MessageRequest = require('../models/MessageRequest');
    const Meeting = require('../models/Meeting');

    // Cascade delete all related data
    await Promise.all([
      // Delete all attendance records for this employee
      Attendance.deleteMany({ employee: employeeId }),

      // Delete all tasks assigned to or created by this employee
      Task.deleteMany({ $or: [{ assignedTo: employeeId }, { createdBy: employeeId }] }),

      // Delete all tickets created by this employee
      Ticket.deleteMany({ createdBy: employeeId }),

      // Delete all leave requests by this employee
      Leave.deleteMany({ employee: employeeId }),

      // Delete all reports for this employee
      Report.deleteMany({ employee: employeeId }),

      // Delete all chat messages sent by this employee
      Chat.deleteMany({ sender: employeeId }),

      // Delete all message requests from/to this employee
      MessageRequest.deleteMany({ $or: [{ from: employeeId }, { to: employeeId }] }),

      // Remove employee from meetings (update meetings to remove this employee from attendees)
      Meeting.updateMany(
        { 'attendees.employee': employeeId },
        { $pull: { attendees: { employee: employeeId } } }
      )
    ]);

    // Delete associated user account
    await User.findOneAndDelete({ employee: employeeId });

    // Delete employee record
    await Employee.findByIdAndDelete(employeeId);

    res.json({
      success: true,
      message: 'Employee and all related data deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting employee',
      error: error.message
    });
  }
});

// @route   POST /api/employees/:id/documents
// @desc    Upload a document for an employee
// @access  Private (Self or HR or above)
router.post('/:id/documents', protect, documentUpload.single('file'), async (req, res) => {
  try {
    const { name } = req.body;
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Check permissions (Self or HR or above)
    const isOwner = req.user.employee && (req.user.employee._id || req.user.employee).toString() === req.params.id;
    const isHR = ['hr', 'manager', 'boss', 'admin'].includes(req.user.role);

    if (!isOwner && !isHR) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload documents for this employee'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    const documentUrl = `${req.protocol}://${req.get('host')}/uploads/documents/${req.file.filename}`;

    const newDocument = {
      name: name || req.file.originalname,
      url: documentUrl,
      uploadedAt: new Date()
    };

    employee.documents.push(newDocument);
    await employee.save();

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { document: newDocument }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error: error.message
    });
  }
});

module.exports = router;

