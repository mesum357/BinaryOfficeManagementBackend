const express = require('express');
const Department = require('../models/Department');
const { protect, isHROrAbove, isBossOrAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/departments
// @desc    Get all departments (public for registration, returns basic info)
// @access  Public
router.get('/', async (req, res) => {
  try {
    // Return hardcoded department options for sign-up form
    const signupDepartments = [
      { _id: 'HR', name: 'HR' },
      { _id: 'Manager', name: 'Manager' },
      { _id: 'Agent', name: 'Agent' },
      { _id: 'Closure', name: 'Closure' },
      { _id: 'Developer', name: 'Developer' },
      { _id: 'SEO Expert', name: 'SEO Expert' },
      { _id: 'Intern', name: 'Intern' }
    ];

    res.json({
      success: true,
      data: { departments: signupDepartments }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching departments',
      error: error.message
    });
  }
});

// @route   GET /api/departments/full
// @desc    Get all departments with full details
// @access  Private
router.get('/full', protect, async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })
      .populate('head', 'firstName lastName employeeId designation')
      .populate('employeeCount')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: { departments }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching departments',
      error: error.message
    });
  }
});

// @route   GET /api/departments/:id
// @desc    Get department by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate('head', 'firstName lastName employeeId designation email phone')
      .populate('parentDepartment', 'name code');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    res.json({
      success: true,
      data: { department }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching department',
      error: error.message
    });
  }
});

// @route   POST /api/departments
// @desc    Create new department
// @access  Private (Boss/Admin only)
router.post('/', protect, isBossOrAdmin, async (req, res) => {
  try {
    const department = await Department.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: { department }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating department',
      error: error.message
    });
  }
});

// @route   PUT /api/departments/:id
// @desc    Update department
// @access  Private (HR or above)
router.put('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('head', 'firstName lastName');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    res.json({
      success: true,
      message: 'Department updated successfully',
      data: { department }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating department',
      error: error.message
    });
  }
});

// @route   DELETE /api/departments/:id
// @desc    Deactivate department
// @access  Private (Boss/Admin only)
router.delete('/:id', protect, isBossOrAdmin, async (req, res) => {
  try {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    res.json({
      success: true,
      message: 'Department deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deactivating department',
      error: error.message
    });
  }
});

module.exports = router;

