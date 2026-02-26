const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// ─── Night-Shift Helper ───────────────────────────────────────────────
// The working day resets at 6:00 PM.
//   • If current time >= 18:00  →  shift date = today (new shift started)
//   • If current time <  18:00  →  shift date = yesterday (still in last night's shift)
// The returned Date is always at midnight (00:00:00) of the shift date,
// which is the value stored in attendance.date for the unique index.
function getShiftDate(now) {
  const d = new Date(now);
  if (d.getHours() < 18) {
    // Before 6 PM → belongs to yesterday's shift
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

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
      earlyClockout: attendance.filter(a => a.status === 'early-clockout').length,
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
// @desc    Check in for the night shift
// @access  Private
router.post('/check-in', protect, async (req, res) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // ── Block clock-in during dead zone: 4:00 AM – 5:59 PM ──
    if (currentHour >= 4 && currentHour < 18) {
      return res.status(400).json({
        success: false,
        message: 'Cannot clock in between 4:00 AM and 6:00 PM. Shift starts at 6:00 PM.'
      });
    }

    const shiftDate = getShiftDate(now);

    // Check if already checked in for this shift
    let attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: shiftDate
    });

    if (attendance && attendance.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in for this shift'
      });
    }

    const checkInTime = now;

    // ── Determine status based on check-in time ──
    // Early:   6:00 PM – 6:59 PM  (18:00 – 18:59)
    // Present: 7:00 PM – 7:05 PM  (19:00 – 19:05)
    // Late:    after 7:05 PM
    let status;
    if (currentHour >= 18 && currentHour < 19) {
      // 6:00 PM to 6:59 PM → Early
      status = 'early';
    } else if (currentHour === 19 && currentMinute <= 5) {
      // 7:00 PM to 7:05 PM → Present
      status = 'present';
    } else {
      // After 7:05 PM (or after midnight before 4 AM) → Late
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
        date: shiftDate,
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
// @desc    Check out for the night shift
// @access  Private
router.post('/check-out', protect, async (req, res) => {
  try {
    const now = new Date();
    const shiftDate = getShiftDate(now);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: shiftDate
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
        message: 'Already checked out for this shift'
      });
    }

    const checkOutTime = now;
    attendance.checkOut = {
      time: checkOutTime,
      ipAddress: req.ip
    };

    // ── Determine checkout status based on time ──
    const hour = checkOutTime.getHours();
    const minute = checkOutTime.getMinutes();

    // Build reference times for comparison
    const earlyClockoutLimit = new Date(checkOutTime);
    earlyClockoutLimit.setHours(3, 55, 0, 0); // 3:55 AM

    const normalStart = new Date(checkOutTime);
    normalStart.setHours(4, 0, 0, 0); // 4:00 AM

    const normalEnd = new Date(checkOutTime);
    normalEnd.setHours(4, 5, 0, 0); // 4:05 AM

    // Only apply checkout-time rules during morning hours (midnight–noon)
    // so evening checkouts (e.g. clocking out early the same evening) fallthrough
    if (hour < 12) {
      if (checkOutTime < earlyClockoutLimit) {
        // Before 3:55 AM → Early Clock Out / Incomplete Day
        attendance.status = 'early-clockout';
      } else if (checkOutTime >= normalStart && checkOutTime <= normalEnd) {
        // 4:00 AM – 4:05 AM → Normal clocked out (no overtime)
        attendance.status = 'clocked-out';
      } else if (checkOutTime > normalEnd) {
        // After 4:05 AM → Overtime
        attendance.status = 'overtime';
      } else {
        // 3:55 AM – 3:59 AM → Normal (grace window)
        attendance.status = 'clocked-out';
      }
    }
    // If checking out in the evening (before midnight) keep the existing status

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
// @desc    Get current shift's attendance status
// @access  Private
router.get('/today', protect, async (req, res) => {
  try {
    const now = new Date();
    const shiftDate = getShiftDate(now);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: shiftDate
    })
      .select('-__v')
      .lean();

    // Check for active break
    const activeBreak = attendance?.breaks?.find(b => !b.endTime) || null;

    // Calculate current working hours if clocked in but not clocked out
    let currentWorkingHours = attendance?.workingHours || 0;
    if (attendance?.checkIn?.time && !attendance?.checkOut?.time) {
      const startTime = new Date(attendance.checkIn.time);
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
    const now = new Date();
    const shiftDate = getShiftDate(now);

    const todayStats = await Attendance.aggregate([
      { $match: { date: shiftDate } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Monthly stats
    const startOfMonth = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), 1);
    const monthlyStats = await Attendance.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: shiftDate } } },
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
// @desc    Get current shift's presence data with active/inactive employees
// @access  Private (HR or above)
router.get('/today-presence', protect, isHROrAbove, async (req, res) => {
  try {
    const now = new Date();
    const shiftDate = getShiftDate(now);

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

    // Get current shift's attendance records
    const todayAttendance = await Attendance.find({ date: shiftDate })
      .populate('employee', 'firstName lastName employeeId department designation')
      .select('-__v')
      .lean();

    // Separate active (clocked in but not clocked out) and inactive (not clocked in or already clocked out)
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
          onBreakList.push({
            ...emp,
            checkInTime: attendance?.checkIn?.time || null,
            isOnBreak: true,
            breakReason: activeBreak.reason || 'break',
            breakStartTime: activeBreak.startTime,
            totalBreakTime
          });
        } else {
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
    const now = new Date();
    const shiftDate = getShiftDate(now);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: shiftDate
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
    const now = new Date();
    const shiftDate = getShiftDate(now);

    const attendance = await Attendance.findOne({
      employee: req.user.employee,
      date: shiftDate
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

