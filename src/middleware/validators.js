const { body, validationResult } = require('express-validator');

// Handle validation errors
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Auth validators
const registerValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  handleValidation
];

const loginValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation
];

// Employee validators
const employeeValidator = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('department').notEmpty().withMessage('Department is required'),
  body('designation').notEmpty().withMessage('Designation is required'),
  body('dateOfJoining').isISO8601().withMessage('Valid date of joining is required'),
  handleValidation
];

// Leave validators
const leaveValidator = [
  body('leaveType').isIn(['annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other'])
    .withMessage('Invalid leave type'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('reason').notEmpty().withMessage('Reason is required'),
  handleValidation
];

// Notice validators
const noticeValidator = [
  body('title').notEmpty().withMessage('Title is required'),
  body('content').notEmpty().withMessage('Content is required'),
  handleValidation
];

// Task validators
const taskValidator = [
  body('title').notEmpty().withMessage('Title is required'),
  body('dueDate').isISO8601().withMessage('Valid due date is required'),
  handleValidation
];

// Meeting validators
const meetingValidator = [
  body('title').notEmpty().withMessage('Title is required'),
  body('startTime').isISO8601().withMessage('Valid start time is required'),
  body('endTime').isISO8601().withMessage('Valid end time is required'),
  handleValidation
];

module.exports = {
  handleValidation,
  registerValidator,
  loginValidator,
  employeeValidator,
  leaveValidator,
  noticeValidator,
  taskValidator,
  meetingValidator
};

