const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from token - populate employee and nested department
    const user = await User.findById(decoded.id).populate({
      path: 'employee',
      populate: { path: 'department', select: 'name' }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

// Authorize by role
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route`
      });
    }
    next();
  };
};

// Check if user is HR or higher
const isHROrAbove = (req, res, next) => {
  const allowedRoles = ['hr', 'manager', 'boss', 'admin'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. HR privileges required.'
    });
  }
  next();
};

// Check if user is Manager or higher
const isManagerOrAbove = (req, res, next) => {
  const allowedRoles = ['manager', 'boss', 'admin'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Manager privileges required.'
    });
  }
  next();
};

// Check if user is Boss or Admin
const isBossOrAdmin = (req, res, next) => {
  const allowedRoles = ['boss', 'admin'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Boss privileges required.'
    });
  }
  next();
};

module.exports = {
  protect,
  authorize,
  isHROrAbove,
  isManagerOrAbove,
  isBossOrAdmin
};

