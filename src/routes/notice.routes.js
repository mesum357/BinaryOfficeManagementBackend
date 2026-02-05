const express = require('express');
const Notice = require('../models/Notice');
const { protect, isHROrAbove, isBossOrAdmin } = require('../middleware/auth');
const { noticeValidator } = require('../middleware/validators');

const router = express.Router();

// @route   GET /api/notices
// @desc    Get all notices
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { 
      category, 
      priority,
      isActive,
      page = 1, 
      limit = 20 
    } = req.query;
    
    const query = {};
    
    // Handle isActive filter - if not specified or "all", fetch all
    if (isActive !== undefined && isActive !== 'all') {
      query.isActive = isActive === 'true' || isActive === true;
    }
    
    if (category) query.category = category;
    if (priority) query.priority = priority;

    // Filter by target audience based on user role (only for employees)
    if (req.user.role === 'employee') {
      query.$or = [
        { targetAudience: 'all' },
        { targetAudience: 'employees' }
      ];
    }

    const notices = await Notice.find(query)
      .populate('publishedBy', 'email role')
      .populate('departments', 'name')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ isPinned: -1, publishedAt: -1 })
      .lean();

    const total = await Notice.countDocuments(query);

    res.json({
      success: true,
      data: {
        notices,
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
      message: 'Error fetching notices',
      error: error.message
    });
  }
});

// @route   GET /api/notices/recent
// @desc    Get recent notices
// @access  Private
router.get('/recent', protect, async (req, res) => {
  try {
    const notices = await Notice.find({ 
      isActive: true,
      $or: [
        { expiresAt: { $gte: new Date() } },
        { expiresAt: null }
      ]
    })
      .populate('publishedBy', 'email')
      .select('-__v')
      .sort({ isPinned: -1, publishedAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: { notices }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching recent notices',
      error: error.message
    });
  }
});

// @route   GET /api/notices/:id
// @desc    Get notice by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id)
      .populate('publishedBy', 'email role')
      .populate('departments', 'name')
      .populate('readBy.user', 'email')
      .populate('acknowledgedBy.user', 'email');

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found'
      });
    }

    // Mark as read
    const alreadyRead = notice.readBy.some(
      r => r.user._id.toString() === req.user._id.toString()
    );
    if (!alreadyRead) {
      notice.readBy.push({ user: req.user._id });
      await notice.save();
    }

    res.json({
      success: true,
      data: { notice }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching notice',
      error: error.message
    });
  }
});

// @route   POST /api/notices
// @desc    Create notice
// @access  Private (HR or above)
router.post('/', protect, isHROrAbove, noticeValidator, async (req, res) => {
  try {
    const notice = await Notice.create({
      ...req.body,
      publishedBy: req.user._id
    });

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io) {
      io.emit('newNotice', {
        id: notice._id,
        title: notice.title,
        category: notice.category,
        priority: notice.priority
      });
    }

    res.status(201).json({
      success: true,
      message: 'Notice published successfully',
      data: { notice }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating notice',
      error: error.message
    });
  }
});

// @route   PUT /api/notices/:id
// @desc    Update notice
// @access  Private (HR or above)
router.put('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const notice = await Notice.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('publishedBy', 'email');

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found'
      });
    }

    res.json({
      success: true,
      message: 'Notice updated successfully',
      data: { notice }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating notice',
      error: error.message
    });
  }
});

// @route   PUT /api/notices/:id/acknowledge
// @desc    Acknowledge notice
// @access  Private
router.put('/:id/acknowledge', protect, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found'
      });
    }

    const alreadyAcknowledged = notice.acknowledgedBy.some(
      a => a.user.toString() === req.user._id.toString()
    );

    if (alreadyAcknowledged) {
      return res.status(400).json({
        success: false,
        message: 'Already acknowledged'
      });
    }

    notice.acknowledgedBy.push({ user: req.user._id });
    await notice.save();

    res.json({
      success: true,
      message: 'Notice acknowledged'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error acknowledging notice',
      error: error.message
    });
  }
});

// @route   DELETE /api/notices/:id
// @desc    Delete notice (hard delete)
// @access  Private (HR or above)
router.delete('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const notice = await Notice.findByIdAndDelete(req.params.id);

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found'
      });
    }

    res.json({
      success: true,
      message: 'Notice deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting notice',
      error: error.message
    });
  }
});

module.exports = router;

