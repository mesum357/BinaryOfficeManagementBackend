const express = require('express');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Task = require('../models/Task');
const { protect, isHROrAbove, isManagerOrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/reports/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Basic stats
    const totalEmployees = await Employee.countDocuments({ status: 'active' });
    
    const presentToday = await Attendance.countDocuments({
      date: today,
      status: { $in: ['present', 'late'] }
    });

    const pendingLeaves = await Leave.countDocuments({ status: 'pending' });

    const pendingTasks = await Task.countDocuments({
      status: { $in: ['pending', 'in-progress'] }
    });

    res.json({
      success: true,
      data: {
        totalEmployees,
        presentToday,
        absentToday: totalEmployees - presentToday,
        pendingLeaves,
        pendingTasks,
        attendanceRate: totalEmployees > 0 
          ? Math.round((presentToday / totalEmployees) * 100) 
          : 0
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
// @desc    Get attendance report
// @access  Private (HR or above)
router.get('/attendance', protect, isHROrAbove, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1));
    const end = endDate ? new Date(endDate) : new Date();

    const matchQuery = {
      date: { $gte: start, $lte: end }
    };

    // Department filter
    let employeeIds = null;
    if (department) {
      const employees = await Employee.find({ department }).select('_id');
      employeeIds = employees.map(e => e._id);
      matchQuery.employee = { $in: employeeIds };
    }

    const attendanceStats = await Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const dailyAttendance = await Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          present: {
            $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] }
          },
          absent: {
            $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
          },
          onLeave: {
            $sum: { $cond: [{ $eq: ['$status', 'on-leave'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const avgWorkingHours = await Attendance.aggregate([
      { 
        $match: { 
          ...matchQuery, 
          status: { $in: ['present', 'late'] } 
        } 
      },
      {
        $group: {
          _id: null,
          avgHours: { $avg: '$workingHours' },
          totalOvertime: { $sum: '$overtime' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        summary: attendanceStats,
        dailyAttendance,
        averageWorkingHours: avgWorkingHours[0]?.avgHours?.toFixed(2) || 0,
        totalOvertime: avgWorkingHours[0]?.totalOvertime?.toFixed(2) || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating attendance report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/leave
// @desc    Get leave report
// @access  Private (HR or above)
router.get('/leave', protect, isHROrAbove, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(endDate) : new Date();

    const matchQuery = {
      startDate: { $gte: start, $lte: end }
    };

    // Department filter
    if (department) {
      const employees = await Employee.find({ department }).select('_id');
      matchQuery.employee = { $in: employees.map(e => e._id) };
    }

    const leaveByType = await Leave.aggregate([
      { $match: { ...matchQuery, status: 'approved' } },
      {
        $group: {
          _id: '$leaveType',
          count: { $sum: 1 },
          totalDays: { $sum: '$totalDays' }
        }
      }
    ]);

    const leaveByStatus = await Leave.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const monthlyLeaves = await Leave.aggregate([
      { $match: { ...matchQuery, status: 'approved' } },
      {
        $group: {
          _id: { $month: '$startDate' },
          count: { $sum: 1 },
          totalDays: { $sum: '$totalDays' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        byType: leaveByType,
        byStatus: leaveByStatus,
        monthly: monthlyLeaves
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating leave report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/tasks
// @desc    Get task report
// @access  Private (Manager or above)
router.get('/tasks', protect, isManagerOrAbove, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const matchQuery = {};
    if (startDate && endDate) {
      matchQuery.createdAt = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }
    if (department) matchQuery.department = department;

    const tasksByStatus = await Task.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const tasksByPriority = await Task.aggregate([
      { $match: { ...matchQuery, status: { $ne: 'completed' } } },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    const overdueTasks = await Task.countDocuments({
      ...matchQuery,
      status: { $nin: ['completed', 'cancelled'] },
      dueDate: { $lt: new Date() }
    });

    const completionRate = await Task.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        byStatus: tasksByStatus,
        byPriority: tasksByPriority,
        overdueTasks,
        completionRate: completionRate[0] 
          ? Math.round((completionRate[0].completed / completionRate[0].total) * 100)
          : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating task report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/employee/:id
// @desc    Get individual employee report
// @access  Private (HR or above, or self)
router.get('/employee/:id', protect, async (req, res) => {
  try {
    const employeeId = req.params.id;

    // Check permissions
    const isOwn = req.user.employee?.toString() === employeeId;
    const isHR = ['hr', 'manager', 'boss', 'admin'].includes(req.user.role);

    if (!isOwn && !isHR) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this report'
      });
    }

    const employee = await Employee.findById(employeeId)
      .populate('department', 'name');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // This year's data
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const attendanceStats = await Attendance.aggregate([
      { 
        $match: { 
          employee: employee._id,
          date: { $gte: startOfYear }
        } 
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const leaveStats = await Leave.aggregate([
      {
        $match: {
          employee: employee._id,
          startDate: { $gte: startOfYear },
          status: 'approved'
        }
      },
      {
        $group: {
          _id: '$leaveType',
          totalDays: { $sum: '$totalDays' }
        }
      }
    ]);

    const taskStats = await Task.aggregate([
      {
        $match: {
          assignedTo: employee._id,
          createdAt: { $gte: startOfYear }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        employee: {
          id: employee._id,
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          department: employee.department,
          designation: employee.designation,
          dateOfJoining: employee.dateOfJoining,
          leaveBalance: employee.leaveBalance
        },
        attendance: attendanceStats,
        leaves: leaveStats,
        tasks: taskStats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating employee report',
      error: error.message
    });
  }
});

// @route   GET /api/reports/department
// @desc    Get department-wise report
// @access  Private (HR or above)
router.get('/department', protect, isHROrAbove, async (req, res) => {
  try {
    const departmentStats = await Employee.aggregate([
      { $match: { status: 'active' } },
      {
        $group: {
          _id: '$department',
          employeeCount: { $sum: 1 },
          avgSalary: { $avg: { $add: ['$salary.basic', '$salary.allowances'] } }
        }
      },
      {
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'department'
        }
      },
      { $unwind: '$department' },
      {
        $project: {
          departmentName: '$department.name',
          employeeCount: 1,
          avgSalary: { $round: ['$avgSalary', 2] }
        }
      }
    ]);

    res.json({
      success: true,
      data: { departmentStats }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating department report',
      error: error.message
    });
  }
});

module.exports = router;

