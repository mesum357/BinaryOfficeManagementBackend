const express = require('express');
const Report = require('../models/Report');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/reports
// @desc    Create a daily report
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { headset, sales } = req.body;

    // Get employee ID
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee record not found. Please contact HR to associate an employee profile with your account.'
      });
    }

    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Always create a new report record as per requirement
    // This allows multiple sales records per day
    const report = await Report.create({
      employee: employeeId,
      date: today,
      headset: headset || 0,
      sales: sales || 0,
      salesCount: req.body.salesCount || 0,
      salesDetails: req.body.salesDetails || ''
    });

    await report.populate({
      path: 'employee',
      select: 'firstName lastName employeeId department',
      populate: { path: 'department', select: 'name' }
    });

    res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      data: { report }
    });
  } catch (error) {
    console.error('Error creating/updating report:', error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A report for today already exists. Please update the existing report.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error submitting report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/my
// @desc    Get current user's reports
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    // Get employee ID
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    if (!employeeId) {
      return res.json({
        success: true,
        data: { reports: [] }
      });
    }

    const { page = 1, limit = 30, startDate, endDate } = req.query;
    const query = { employee: employeeId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const reports = await Report.find(query)
      .populate('employee', 'firstName lastName employeeId department')
      .select('-__v')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Report.countDocuments(query);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reports',
      error: error.message
    });
  }
});

// @route   GET /api/reports/my/weekly
// @desc    Get current user's weekly reports
// @access  Private
router.get('/my/weekly', protect, async (req, res) => {
  try {
    // Get employee ID
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    if (!employeeId) {
      return res.json({
        success: true,
        data: { reports: [] }
      });
    }

    // Get start of current week (Sunday)
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Get end of current week (Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const reports = await Report.find({
      employee: employeeId,
      date: {
        $gte: startOfWeek,
        $lte: endOfWeek
      }
    })
      .populate('employee', 'firstName lastName employeeId department')
      .select('-__v')
      .sort({ date: -1 })
      .lean();

    res.json({
      success: true,
      data: { reports }
    });
  } catch (error) {
    console.error('Error fetching weekly reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching weekly reports',
      error: error.message
    });
  }
});

// @route   GET /api/reports/my/monthly
// @desc    Get current user's monthly reports
// @access  Private
router.get('/my/monthly', protect, async (req, res) => {
  try {
    // Get employee ID
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    if (!employeeId) {
      return res.json({
        success: true,
        data: { reports: [] }
      });
    }

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Get end of current month
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const reports = await Report.find({
      employee: employeeId,
      date: {
        $gte: startOfMonth,
        $lte: endOfMonth
      }
    })
      .populate('employee', 'firstName lastName employeeId department')
      .select('-__v')
      .sort({ date: -1 })
      .lean();

    res.json({
      success: true,
      data: { reports }
    });
  } catch (error) {
    console.error('Error fetching monthly reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching monthly reports',
      error: error.message
    });
  }
});

// @route   GET /api/reports/today
// @desc    Get today's report for current user
// @access  Private
router.get('/today', protect, async (req, res) => {
  try {
    // Get employee ID
    let employeeId = null;
    if (req.user.employee) {
      employeeId = req.user.employee._id || req.user.employee;
    }

    if (!employeeId) {
      return res.json({
        success: true,
        data: { report: null }
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reports = await Report.find({
      employee: employeeId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    })
      .populate('employee', 'firstName lastName employeeId')
      .lean();

    if (reports.length === 0) {
      return res.json({
        success: true,
        data: { report: null }
      });
    }

    // Aggregate multiple reports for today
    const aggregatedReport = {
      ...reports[0],
      headset: reports.reduce((sum, r) => sum + (r.headset || 0), 0),
      sales: reports.reduce((sum, r) => sum + (r.sales || 0), 0),
      salesCount: reports.reduce((sum, r) => sum + (r.salesCount || 0), 0),
      salesDetails: reports.map(r => r.salesDetails).filter(Boolean).join('; '),
      isAggregated: true,
      recordCount: reports.length
    };

    res.json({
      success: true,
      data: { report: aggregatedReport }
    });
  } catch (error) {
    console.error('Error fetching today\'s report:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/dashboard
// @desc    Get dashboard analytics (HR and above)
// @access  Private (HR or above)
router.get('/dashboard', protect, isHROrAbove, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const Attendance = require('../models/Attendance');
    const Leave = require('../models/Leave');
    const User = require('../models/User');

    // Count only employees that actually use the Employee Website:
    // approved users with role 'employee' mapped to an Employee doc.
    const usersWithEmployeeAccounts = await User.find({
      verificationStatus: 'approved',
      role: 'employee'
    }).select('employee');

    const employeeIds = usersWithEmployeeAccounts
      .map(u => u.employee)
      .filter(Boolean);

    const totalEmployees = await Employee.countDocuments({
      _id: { $in: employeeIds },
      status: 'active'
    });
    const pendingLeaves = await Leave.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        totalEmployees,
        pendingLeaves
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats',
      error: error.message
    });
  }
});

// @route   GET /api/reports/attendance
// @desc    Get attendance report (HR and above)
// @access  Private (HR or above)
router.get('/attendance', protect, isHROrAbove, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const Attendance = require('../models/Attendance');

    const dateQuery = {};
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = new Date(startDate);
      if (endDate) dateQuery.date.$lte = new Date(endDate);
    }

    const dailyAttendance = await Attendance.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          present: {
            $sum: {
              $cond: [
                { $in: ['$status', ['present', 'late']] },
                1,
                0
              ]
            }
          },
          absent: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'absent'] },
                1,
                0
              ]
            }
          },
          onLeave: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'on-leave'] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: { dailyAttendance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/leave
// @desc    Get leave report (HR and above)
// @access  Private (HR or above)
router.get('/leave', protect, isHROrAbove, async (req, res) => {
  try {
    const Leave = require('../models/Leave');
    const { startDate, endDate } = req.query;

    const query = {};
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }

    const leaves = await Leave.find(query)
      .populate('employee', 'firstName lastName employeeId')
      .lean();

    res.json({
      success: true,
      data: { leaves }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leave report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/tasks
// @desc    Get task report (HR and above)
// @access  Private (HR or above)
router.get('/tasks', protect, isHROrAbove, async (req, res) => {
  try {
    const Task = require('../models/Task');
    const tasks = await Task.find()
      .populate('assignedTo', 'firstName lastName')
      .lean();

    res.json({
      success: true,
      data: { tasks }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching task report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/department
// @desc    Get department report (HR and above)
// @access  Private (HR or above)
router.get('/department', protect, isHROrAbove, async (req, res) => {
  try {
    const Department = require('../models/Department');
    const Employee = require('../models/Employee');

    const departments = await Department.find().lean();
    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const employeeCount = await Employee.countDocuments({
          department: dept._id,
          status: 'active'
        });
        return {
          ...dept,
          employeeCount
        };
      })
    );

    res.json({
      success: true,
      data: { departments: departmentStats }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching department report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/employee/:id
// @desc    Get employee report (HR and above)
// @access  Private (HR or above)
router.get('/employee/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const Attendance = require('../models/Attendance');
    const Leave = require('../models/Leave');

    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const attendance = await Attendance.find({ employee: req.params.id }).lean();
    const leaves = await Leave.find({ employee: req.params.id }).lean();

    res.json({
      success: true,
      data: {
        employee,
        attendance,
        leaves
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching employee report',
      error: error.message
    });
  }
});

// @route   GET /api/reports
// @desc    Get all daily reports (HR and above)
// @access  Private (HR or above)
router.get('/', protect, isHROrAbove, async (req, res) => {
  try {
    const {
      employee,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (employee) {
      query.employee = employee;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const reports = await Report.find(query)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department designation',
        populate: { path: 'department', select: 'name' }
      })
      .select('-__v')
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Report.countDocuments(query);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reports',
      error: error.message
    });
  }
});

// @route   GET /api/reports/stats
// @desc    Get report statistics (HR and above)
// @access  Private (HR or above)
router.get('/stats', protect, isHROrAbove, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateQuery = {};
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateQuery.date.$lte = end;
      }
    }

    // Get headset usage stats - group by date string for proper grouping
    const headsetStats = await Report.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          dateValue: { $first: '$date' },
          uniqueEmployees: { $addToSet: '$employee' },
          headsetCount: { $sum: '$headset' }
        }
      },
      { $sort: { dateValue: -1 } },
      { $limit: 30 },
      {
        $project: {
          _id: 0,
          date: '$dateValue',
          totalEmployees: { $size: '$uniqueEmployees' },
          headsetCount: 1
        }
      }
    ]);

    // Get sales stats - group by date string for proper grouping
    const salesStats = await Report.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          dateValue: { $first: '$date' },
          uniqueEmployees: { $addToSet: '$employee' },
          totalSales: { $sum: '$sales' },
          totalSalesCount: { $sum: '$salesCount' }
        }
      },
      { $sort: { dateValue: -1 } },
      { $limit: 30 },
      {
        $project: {
          _id: 0,
          date: '$dateValue',
          totalSales: 1,
          totalSalesCount: 1,
          employeeCount: { $size: '$uniqueEmployees' },
          avgSales: {
            $cond: [
              { $eq: [{ $size: '$uniqueEmployees' }, 0] },
              0,
              { $round: [{ $divide: ['$totalSales', { $size: '$uniqueEmployees' }] }, 2] }
            ]
          }
        }
      }
    ]);

    // Get employee-wise stats
    const employeeStats = await Report.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: '$employee',
          totalSales: { $sum: '$sales' },
          totalSalesCount: { $sum: '$salesCount' },
          totalReports: { $sum: 1 },
          headsetDays: {
            $sum: '$headset'
          }
        }
      },
      {
        $lookup: {
          from: 'employees',
          localField: '_id',
          foreignField: '_id',
          as: 'employeeData'
        }
      },
      { $unwind: '$employeeData' },
      {
        $project: {
          employeeId: '$employeeData.employeeId',
          firstName: '$employeeData.firstName',
          lastName: '$employeeData.lastName',
          totalSales: 1,
          totalSalesCount: 1,
          totalReports: 1,
          headsetDays: 1
        }
      },
      { $sort: { totalSales: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        headsetStats: headsetStats.map(stat => ({
          _id: stat.date,
          totalEmployees: stat.totalEmployees || 0,
          headsetCount: stat.headsetCount || 0
        })),
        salesStats: salesStats.map(stat => ({
          _id: stat.date,
          totalSales: stat.totalSales || 0,
          totalSalesCount: stat.totalSalesCount || 0,
          employeeCount: stat.employeeCount || 0,
          avgSales: stat.avgSales || 0
        })),
        employeeStats: employeeStats || []
      }
    });
  } catch (error) {
    console.error('Error fetching report stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching report statistics',
      error: error.message
    });
  }
});

// @route   POST /api/reports/employee/:employeeId
// @desc    Create/update report for a specific employee (Manager only)
// @access  Private (Manager with department = 'Manager')
router.post('/employee/:employeeId', protect, async (req, res) => {
  try {
    // Check if user is a manager by designation
    const userDesignation = req.user.employee?.designation;
    const isManager = typeof userDesignation === 'string' && userDesignation.toLowerCase() === 'manager';

    if (!isManager) {
      return res.status(403).json({
        success: false,
        message: 'Only managers can update employee reports'
      });
    }

    const { headset, sales } = req.body;
    const employeeId = req.params.employeeId;

    // Verify employee exists
    const Employee = require('../models/Employee');
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Use provided date or today's date at midnight
    const reportDate = req.body.date ? new Date(req.body.date) : new Date();
    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }
    reportDate.setHours(0, 0, 0, 0);

    // Always create a new report record as per requirement (Manager view)
    // This enables multiple sales records for the same employee on the same day
    const report = await Report.create({
      employee: employeeId,
      date: reportDate,
      headset: headset || 0,
      sales: sales || 0,
      salesCount: req.body.salesCount || 0,
      salesDetails: req.body.salesDetails || '',
      createdBy: req.user._id
    });

    await report.populate({
      path: 'employee',
      select: 'firstName lastName employeeId department',
      populate: { path: 'department', select: 'name' }
    });

    res.status(201).json({
      success: true,
      message: `Report submitted for ${employee.firstName} ${employee.lastName}`,
      data: { report }
    });
  } catch (error) {
    console.error('Error creating/updating employee report:', error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A report for this employee and date already exists with a unique constraint. Please contact admin if this persists.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error submitting employee report',
      error: error.message
    });
  }
});

// @route   PUT /api/reports/:id
// @desc    Update a specific report (Manager only)
// @access  Private (Manager)
router.put('/:id', protect, async (req, res) => {
  try {
    const userDesignation = req.user.employee?.designation;
    const isManager = typeof userDesignation === 'string' && userDesignation.toLowerCase() === 'manager';

    if (!isManager) {
      return res.status(403).json({
        success: false,
        message: 'Only managers can update reports'
      });
    }

    const { headset, sales, salesCount, salesDetails } = req.body;
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    if (headset !== undefined) report.headset = headset;
    if (sales !== undefined) report.sales = sales;
    if (salesCount !== undefined) report.salesCount = salesCount;
    if (salesDetails !== undefined) report.salesDetails = salesDetails;

    report.updatedBy = req.user._id;
    await report.save();

    await report.populate({
      path: 'employee',
      select: 'firstName lastName employeeId department',
      populate: { path: 'department', select: 'name' }
    });

    res.json({
      success: true,
      message: 'Report updated successfully',
      data: { report }
    });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/employee/:employeeId/today
// @desc    Get today's report for a specific employee (Manager only)
// @access  Private (Manager with department = 'Manager')
router.get('/employee/:employeeId/today', protect, async (req, res) => {
  try {
    // Check if user is a manager by designation
    const userDesignation = req.user.employee?.designation;
    const isManager = typeof userDesignation === 'string' && userDesignation.toLowerCase() === 'manager';

    if (!isManager) {
      return res.status(403).json({
        success: false,
        message: 'Only managers can view employee reports'
      });
    }

    const employeeId = req.params.employeeId;
    const { date } = req.query;

    // Use provided date or today's date at midnight
    const reportDate = date ? new Date(date) : new Date();
    if (isNaN(reportDate.getTime())) {
      console.error('Invalid date provided:', date);
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }
    reportDate.setHours(0, 0, 0, 0);

    const reports = await Report.find({
      employee: employeeId,
      date: {
        $gte: reportDate,
        $lt: new Date(reportDate.getTime() + 24 * 60 * 60 * 1000)
      }
    })
      .populate('employee', 'firstName lastName employeeId')
      .lean();

    if (reports.length === 0) {
      return res.json({
        success: true,
        data: { report: null }
      });
    }

    // Aggregate multiple reports
    const aggregatedReport = {
      ...reports[0],
      headset: reports.reduce((sum, r) => sum + (r.headset || 0), 0),
      sales: reports.reduce((sum, r) => sum + (r.sales || 0), 0),
      salesCount: reports.reduce((sum, r) => sum + (r.salesCount || 0), 0),
      salesDetails: reports.map(r => r.salesDetails).filter(Boolean).join('; '),
      isAggregated: true,
      recordCount: reports.length
    };

    res.json({
      success: true,
      data: { report: aggregatedReport }
    });
  } catch (error) {
    console.error('Error fetching employee report:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employee report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/manager/updated
// @desc    Get reports created/updated by the manager
// @access  Private (Manager with department = 'Manager')
router.get('/manager/updated', protect, async (req, res) => {
  try {
    // Check if user is a manager by designation
    const userDesignation = req.user.employee?.designation;
    const isManager = typeof userDesignation === 'string' && userDesignation.toLowerCase() === 'manager';

    if (!isManager) {
      return res.status(403).json({
        success: false,
        message: 'Only managers can access this endpoint'
      });
    }

    const { page = 1, limit = 30, startDate, endDate } = req.query;

    const query = {
      $or: [
        { createdBy: req.user._id },
        { updatedBy: req.user._id }
      ]
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // Get reports created or updated by this manager
    const reports = await Report.find(query)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department',
        populate: { path: 'department', select: 'name' }
      })
      .select('-__v')
      .sort({ date: -1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Report.countDocuments(query);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching manager updated reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching manager updated reports',
      error: error.message
    });
  }
});

module.exports = router;

