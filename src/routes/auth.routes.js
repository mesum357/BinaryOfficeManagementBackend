const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Department = require('../models/Department');
const { protect, isHROrAbove } = require('../middleware/auth');
const { loginValidator } = require('../middleware/validators');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Registration validator
const registerValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('department').notEmpty().withMessage('Department is required'),
  body('designation').notEmpty().withMessage('Designation is required'),
];

// @route   POST /api/auth/register
// @desc    Register new employee (pending verification)
// @access  Public
router.post('/register', registerValidator, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone, 
      department, 
      designation,
      dateOfBirth,
      gender,
      address
    } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Validate department exists
    const dept = await Department.findById(department);
    if (!dept) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department selected'
      });
    }

    // Generate unique employeeId by finding the highest existing ID
    const employees = await Employee.find({}, { employeeId: 1 });
    let maxId = 0;
    for (const emp of employees) {
      if (emp.employeeId) {
        const idNum = parseInt(emp.employeeId.replace('EMP', ''), 10);
        if (!isNaN(idNum) && idNum > maxId) {
          maxId = idNum;
        }
      }
    }
    const employeeId = `EMP${String(maxId + 1).padStart(4, '0')}`;

    // Create employee record with pending status
    const employee = await Employee.create({
      employeeId,
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      department,
      designation,
      dateOfBirth,
      gender,
      address,
      dateOfJoining: new Date(),
      status: 'pending' // Employee starts as pending
    });

    // Create user with pending verification
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      role: 'employee',
      employee: employee._id,
      verificationStatus: 'pending',
      isActive: false // Not active until approved
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Your account has been sent for verification. You will be notified once approved.',
      data: {
        email: user.email,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user using Passport.js
// @access  Public
router.post('/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Authentication error',
        error: err.message
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: info?.message || 'Invalid credentials',
        code: info?.code
      });
    }

    // Update last login
    user.lastLogin = new Date();
    user.save({ validateBeforeSave: false });

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          verificationStatus: user.verificationStatus,
          employee: user.employee ? {
            id: user.employee._id,
            employeeId: user.employee.employeeId,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            fullName: user.employee.fullName,
            avatar: user.employee.avatar,
            department: user.employee.department,
            designation: user.employee.designation
          } : null
        }
      }
    });
  })(req, res, next);
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'employee',
      populate: { path: 'department' }
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          verificationStatus: user.verificationStatus,
          employee: user.employee
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message
    });
  }
});

// @route   GET /api/auth/pending-registrations
// @desc    Get all pending employee registrations
// @access  Private (HR or above)
router.get('/pending-registrations', protect, isHROrAbove, async (req, res) => {
  try {
    const pendingUsers = await User.find({ verificationStatus: 'pending' })
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name code' }
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { 
        pendingRegistrations: pendingUsers.map(user => ({
          userId: user._id,
          email: user.email,
          createdAt: user.createdAt,
          employee: user.employee
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching pending registrations',
      error: error.message
    });
  }
});

// @route   PUT /api/auth/approve/:userId
// @desc    Approve employee registration
// @access  Private (HR or above)
router.put('/approve/:userId', protect, isHROrAbove, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.verificationStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This registration has already been processed'
      });
    }

    // Approve the user
    user.verificationStatus = 'approved';
    user.isActive = true;
    user.verifiedBy = req.user._id;
    user.verifiedAt = new Date();
    await user.save();

    // Update employee status to active
    await Employee.findByIdAndUpdate(user.employee, { status: 'active' });

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io) {
      io.emit('registrationApproved', { userId: user._id, email: user.email });
    }

    res.json({
      success: true,
      message: 'Employee registration approved successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error approving registration',
      error: error.message
    });
  }
});

// @route   PUT /api/auth/reject/:userId
// @desc    Reject employee registration
// @access  Private (HR or above)
router.put('/reject/:userId', protect, isHROrAbove, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.verificationStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This registration has already been processed'
      });
    }

    // Reject the user
    user.verificationStatus = 'rejected';
    user.isActive = false;
    user.verifiedBy = req.user._id;
    user.verifiedAt = new Date();
    user.rejectionReason = reason || 'Registration rejected by admin';
    await user.save();

    // Update employee status to rejected
    await Employee.findByIdAndUpdate(user.employee, { status: 'rejected' });

    res.json({
      success: true,
      message: 'Employee registration rejected',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting registration',
      error: error.message
    });
  }
});

// @route   GET /api/auth/registration-stats
// @desc    Get registration statistics
// @access  Private (HR or above)
router.get('/registration-stats', protect, isHROrAbove, async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$verificationStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    const statsMap = {
      pending: 0,
      approved: 0,
      rejected: 0
    };

    stats.forEach(s => {
      statsMap[s._id] = s.count;
    });

    res.json({
      success: true,
      data: { stats: statsMap }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching registration stats',
      error: error.message
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @route   PUT /api/auth/change-password
// @desc    Change password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
});

// @route   GET /api/auth/check-status/:email
// @desc    Check registration status by email
// @access  Public
router.get('/check-status/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email.toLowerCase() })
      .select('verificationStatus rejectionReason createdAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No registration found with this email'
      });
    }

    res.json({
      success: true,
      data: {
        status: user.verificationStatus,
        rejectionReason: user.rejectionReason,
        registeredAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking status',
      error: error.message
    });
  }
});

module.exports = router;
