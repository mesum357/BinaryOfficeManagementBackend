const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/attendance
// @desc    Get attendance records
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const {
      employee,
      startDate,
      endDate,
      status,
      page = 1,
      limit = 30
    } = req.query;

    const query = {};

    // Non-HR users can only see their own attendance
    if (!['hr', 'manager', 'boss', 'admin'].includes(req.user.role)) {
      query.employee = req.user.employee;
    } else if (employee) {
      query.employee = employee;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    if (status) query.status = status;

    const attendance = await Attendance.find(query)
      .populate('employee', 'firstName lastName employeeId department')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ date: -1 })
      .lean();

    const total = await Attendance.countDocuments(query);

    res.json({
      success: true,
      data: {
        attendance,
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
      message: 'Error fetching attendance',
      error: error.message
    });
  }
});

// @route   GET /api/attendance/my
// @desc    Get current user's attendance
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    const { month, year } = req.query;

    let startDate, endDate;
    if (month && year) {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else {
      // Default to current month
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const attendance = await Attendance.find({
      employee: req.user.employee,
      date: { $gte: startDate, $lte: endDate }
    })
      .select('-__v')
      .sort({ date: -1 })
      .lean();

    // Calculate summary
    const summary = {
      present: attendance.filter(a => a.status === 'present').length,
      absent: attendance.filter(a => a.status === 'absent').length,
      late: attendance.filter(a => a.status === 'late').length,
      halfDay: attendance.filter(a => a.status === 'half-day').length,
      onLeave: attendance.filter(a => a.status === 'on-leave').length,
      totalWorkingHours: attendance.reduce((sum, a) => sum + (a.workingHours || 0), 0),
      totalOvertime: attendance.reduce((sum, a) => sum + (a.overtime || 0), 0)
    };

    res.json({
      success: true,
      data: { attendance, summary }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance',
      error: error.message
    });
  }
});

// @route   POST /api/attendance/check-in
// @desc    Check in for the day
// @access  Private
router.post('/check-in', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already checked in today
    let attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: today
    });

    if (attendance && attendance.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in today'
      });
    }

    const checkInTime = new Date();

    // Block clock-in after 4:00 PM
    const cutoffTime = new Date();
    cutoffTime.setHours(16, 0, 0, 0); // 4:00 PM
    if (checkInTime >= cutoffTime) {
      return res.status(400).json({
        success: false,
        message: 'Cannot clock in after 4:00 PM'
      });
    }

    // Determine status based on check-in time
    const earlyThreshold = new Date();
    earlyThreshold.setHours(7, 0, 0, 0); // 7:00 AM

    const presentThreshold = new Date();
    presentThreshold.setHours(7, 5, 0, 0); // 7:05 AM

    let status;
    if (checkInTime < earlyThreshold) {
      status = 'early';
    } else if (checkInTime <= presentThreshold) {
      status = 'present';
    } else {
      status = 'late';
    }

    if (attendance) {
      attendance.checkIn = {
        time: checkInTime,
        ipAddress: req.ip
      };
      attendance.status = status;
      await attendance.save();
    } else {
      attendance = await Attendance.create({
        employee: req.user.employee,
        date: today,
        checkIn: {
          time: checkInTime,
          ipAddress: req.ip
        },
        status
      });
    }

    res.json({
      success: true,
      message: 'Checked in successfully',
      data: { attendance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking in',
      error: error.message
    });
  }
});

// @route   POST /api/attendance/check-out
// @desc    Check out for the day
// @access  Private
router.post('/check-out', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: today
    });

    if (!attendance || !attendance.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'You need to check in first'
      });
    }

    if (attendance.checkOut?.time) {
      return res.status(400).json({
        success: false,
        message: 'Already checked out today'
      });
    }

    const checkOutTime = new Date();
    attendance.checkOut = {
      time: checkOutTime,
      ipAddress: req.ip
    };

    // Determine checkout status based on time
    const normalEndStart = new Date();
    normalEndStart.setHours(16, 0, 0, 0); // 4:00 PM
    const normalEndEnd = new Date();
    normalEndEnd.setHours(16, 5, 0, 0); // 4:05 PM

    if (checkOutTime > normalEndEnd) {
      // After 4:05 PM → Overtime
      attendance.status = 'overtime';
    } else if (checkOutTime >= normalEndStart && checkOutTime <= normalEndEnd) {
      // 4:00 PM – 4:05 PM → Clocked Out (normal)
      attendance.status = 'clocked-out';
    }
    // If before 4:00 PM, keep the existing status (early/present/late)

    await attendance.save();

    res.json({
      success: true,
      message: 'Checked out successfully',
      data: { attendance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking out',
      error: error.message
    });
  }
});

// @route   GET /api/attendance/today
// @desc    Get today's attendance status
// @access  Private
router.get('/today', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: today
    })
      .select('-__v')
      .lean();

    // Check for active break
    const activeBreak = attendance?.breaks?.find(b => !b.endTime) || null;

    // Calculate current working hours if clocked in but not clocked out
    let currentWorkingHours = attendance?.workingHours || 0;
    if (attendance?.checkIn?.time && !attendance?.checkOut?.time) {
      const startTime = new Date(attendance.checkIn.time);
      const now = new Date();
      const diffMs = now - startTime;
      let diffHours = diffMs / (1000 * 60 * 60);

      // Subtract break time
      let breakHours = 0;
      if (attendance.breaks && attendance.breaks.length > 0) {
        breakHours = attendance.breaks.reduce((total, b) => {
          if (b.endTime) {
            return total + (b.duration || 0);
          } else {
            // Include duration of active break up to now
            const breakDiffMs = now - new Date(b.startTime);
            return total + (breakDiffMs / (1000 * 60));
          }
        }, 0) / 60;
      }
      currentWorkingHours = Math.max(0, diffHours - breakHours);
    }

    res.json({
      success: true,
      data: {
        attendance,
        isCheckedIn: !!attendance?.checkIn?.time,
        isCheckedOut: !!attendance?.checkOut?.time,
        isOnBreak: !!activeBreak,
        activeBreak,
        currentWorkingHours: parseFloat(currentWorkingHours.toFixed(2))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s attendance',
      error: error.message
    });
  }
});

// @route   GET /api/attendance/stats
// @desc    Get attendance statistics
// @access  Private (HR or above)
router.get('/stats', protect, isHROrAbove, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayStats = await Attendance.aggregate([
      { $match: { date: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Monthly stats
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlyStats = await Attendance.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: today } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: { todayStats, monthlyStats }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance stats',
      error: error.message
    });
  }
});

// @route   GET /api/attendance/today-presence
// @desc    Get today's presence data with active/inactive employees
// @access  Private (HR or above)
router.get('/today-presence', protect, isHROrAbove, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get employee IDs that are linked to HR, Boss, Admin, or Manager users (exclude from attendance)
    const User = require('../models/User');
    const managementUsers = await User.find({
      role: { $in: ['hr', 'boss', 'admin', 'manager'] },
      employee: { $exists: true, $ne: null }
    }).select('employee').lean();

    const managementEmployeeIds = managementUsers.map(u => u.employee.toString());

    // Get all employees with status 'active', excluding management roles
    const activeEmployees = await Employee.find({
      status: 'active',
      _id: { $nin: managementEmployeeIds }
    })
      .select('_id firstName lastName employeeId department designation')
      .populate('department', 'name')
      .lean();

    // Get today's attendance records
    const todayAttendance = await Attendance.find({ date: today })
      .populate('employee', 'firstName lastName employeeId department designation')
      .select('-__v')
      .lean();

    // Separate active (clocked in but not clocked out) and inactive (not clocked in or already clocked out)
    // Handle both populated and non-populated employee references
    const activeEmployeeIds = new Set(
      todayAttendance
        .filter(att => att.checkIn?.time && !att.checkOut?.time)
        .map(att => {
          const empId = att.employee?._id || att.employee;
          return empId?.toString();
        })
        .filter(Boolean)
    );

    const presentToday = todayAttendance.filter(att => att.checkIn?.time).length;

    // Create a map for quick lookup
    const attendanceMap = new Map();
    todayAttendance.forEach(att => {
      const empId = (att.employee?._id || att.employee)?.toString();
      if (empId) {
        attendanceMap.set(empId, att);
      }
    });

    // Helper function to calculate total break time in minutes
    const calculateTotalBreakTime = (breaks) => {
      if (!breaks || breaks.length === 0) return 0;
      return breaks.reduce((total, b) => {
        if (b.endTime && b.duration) {
          return total + b.duration;
        }
        return total;
      }, 0);
    };

    // Separate employees into active (working), on break, and inactive
    const activeList = [];
    const onBreakList = [];

    activeEmployees
      .filter(emp => activeEmployeeIds.has(emp._id.toString()))
      .forEach(emp => {
        const attendance = attendanceMap.get(emp._id.toString());
        const activeBreak = attendance?.breaks?.find(b => !b.endTime);
        const totalBreakTime = calculateTotalBreakTime(attendance?.breaks);

        if (activeBreak) {
          // Employee is on break
          onBreakList.push({
            ...emp,
            checkInTime: attendance?.checkIn?.time || null,
            isOnBreak: true,
            breakReason: activeBreak.reason || 'break',
            breakStartTime: activeBreak.startTime,
            totalBreakTime
          });
        } else {
          // Employee is actively working
          activeList.push({
            ...emp,
            checkInTime: attendance?.checkIn?.time || null,
            isOnBreak: false,
            totalBreakTime
          });
        }
      });

    const inactiveList = activeEmployees
      .filter(emp => !activeEmployeeIds.has(emp._id.toString()))
      .map(emp => {
        const attendance = attendanceMap.get(emp._id.toString());
        const totalBreakTime = calculateTotalBreakTime(attendance?.breaks);
        return {
          ...emp,
          isCheckedIn: !!attendance?.checkIn?.time,
          isCheckedOut: !!attendance?.checkOut?.time,
          totalBreakTime
        };
      });

    res.json({
      success: true,
      data: {
        presentToday,
        active: activeList,
        onBreak: onBreakList,
        inactive: inactiveList,
        totalActive: activeList.length,
        totalOnBreak: onBreakList.length,
        totalInactive: inactiveList.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s presence data',
      error: error.message
    });
  }
});

// @route   POST /api/attendance/break/start
// @desc    Start a break
// @access  Private
router.post('/break/start', protect, async (req, res) => {
  try {
    const { reason } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: today
    });

    if (!attendance || !attendance.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'You need to check in first'
      });
    }

    if (attendance.checkOut?.time) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start break after checkout'
      });
    }

    // Check if there's an active break (no endTime)
    const activeBreak = attendance.breaks?.find(b => !b.endTime);
    if (activeBreak) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active break. Please end it first.'
      });
    }

    const breakStartTime = new Date();
    attendance.breaks = attendance.breaks || [];
    attendance.breaks.push({
      startTime: breakStartTime,
      reason: reason || 'break'
    });

    await attendance.save();

    res.json({
      success: true,
      message: 'Break started',
      data: {
        attendance,
        activeBreak: attendance.breaks[attendance.breaks.length - 1]
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error starting break',
      error: error.message
    });
  }
});

// @route   POST /api/attendance/break/end
// @desc    End a break
// @access  Private
router.post('/break/end', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: today
    });

    if (!attendance || !attendance.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'You need to check in first'
      });
    }

    // Find active break (no endTime)
    const activeBreakIndex = attendance.breaks?.findIndex(b => !b.endTime);
    if (activeBreakIndex === -1 || activeBreakIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: 'No active break found'
      });
    }

    const breakEndTime = new Date();
    const activeBreak = attendance.breaks[activeBreakIndex];
    activeBreak.endTime = breakEndTime;

    // Calculate break duration in minutes
    const durationMs = breakEndTime.getTime() - activeBreak.startTime.getTime();
    activeBreak.duration = Math.floor(durationMs / (1000 * 60));

    await attendance.save();

    res.json({
      success: true,
      message: 'Break ended',
      data: { attendance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error ending break',
      error: error.message
    });
  }
});

// @route   PUT /api/attendance/:id
// @desc    Update attendance record
// @access  Private (HR or above)
router.put('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const attendance = await Attendance.findByIdAndUpdate(
      req.params.id,
      { ...req.body, approvedBy: req.user._id },
      { new: true, runValidators: true }
    ).populate('employee', 'firstName lastName');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: { attendance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating attendance',
      error: error.message
    });
  }
});

module.exports = router;

