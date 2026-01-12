const express = require('express');
const Settings = require('../models/Settings');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/settings
// @desc    Get settings
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      success: true,
      data: { settings }
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings',
      error: error.message
    });
  }
});

// @route   PUT /api/settings
// @desc    Update settings
// @access  Private (HR or Boss)
router.put('/', protect, isHROrAbove, async (req, res) => {
  try {
    const { companyName } = req.body;

    if (!companyName || companyName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Company name is required'
      });
    }

    let settings = await Settings.findOne();
    
    if (!settings) {
      // Create new settings document
      settings = await Settings.create({
        companyName: companyName.trim(),
        updatedBy: req.user._id
      });
    } else {
      // Update existing settings
      settings.companyName = companyName.trim();
      settings.updatedBy = req.user._id;
      await settings.save();
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: { settings }
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settings',
      error: error.message
    });
  }
});

module.exports = router;
