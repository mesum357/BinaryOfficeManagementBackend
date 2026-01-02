const express = require('express');
const Recruitment = require('../models/Recruitment');
const { protect, isHROrAbove } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/recruitment
// @desc    Get all job postings
// @access  Private (HR or above)
router.get('/', protect, isHROrAbove, async (req, res) => {
  try {
    const { status, department, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (department) query.department = department;

    const jobs = await Recruitment.find(query)
      .populate('department', 'name')
      .populate('postedBy', 'email')
      .populate('hiringManager', 'firstName lastName')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Recruitment.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs,
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
      message: 'Error fetching job postings',
      error: error.message
    });
  }
});

// @route   GET /api/recruitment/open
// @desc    Get open job postings (public)
// @access  Public
router.get('/open', async (req, res) => {
  try {
    const jobs = await Recruitment.find({ status: 'open' })
      .populate('department', 'name')
      .select('-applicants')
      .sort({ postedAt: -1 });

    res.json({
      success: true,
      data: { jobs }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching open positions',
      error: error.message
    });
  }
});

// @route   GET /api/recruitment/stats
// @desc    Get recruitment statistics
// @access  Private (HR or above)
router.get('/stats', protect, isHROrAbove, async (req, res) => {
  try {
    const stats = await Recruitment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalApplicants = await Recruitment.aggregate([
      { $unwind: '$applicants' },
      {
        $group: {
          _id: '$applicants.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const departmentWise = await Recruitment.aggregate([
      { $match: { status: 'open' } },
      {
        $group: {
          _id: '$department',
          openings: { $sum: '$openings' }
        }
      },
      {
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'dept'
        }
      },
      { $unwind: '$dept' },
      {
        $project: {
          department: '$dept.name',
          openings: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        jobsByStatus: stats,
        applicantsByStatus: totalApplicants,
        openingsByDepartment: departmentWise
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching recruitment stats',
      error: error.message
    });
  }
});

// @route   GET /api/recruitment/:id
// @desc    Get job posting by ID
// @access  Private (HR or above)
router.get('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const job = await Recruitment.findById(req.params.id)
      .populate('department', 'name')
      .populate('postedBy', 'email')
      .populate('hiringManager', 'firstName lastName email');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job posting not found'
      });
    }

    res.json({
      success: true,
      data: { job }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching job posting',
      error: error.message
    });
  }
});

// @route   POST /api/recruitment
// @desc    Create job posting
// @access  Private (HR or above)
router.post('/', protect, isHROrAbove, async (req, res) => {
  try {
    const job = await Recruitment.create({
      ...req.body,
      postedBy: req.user._id,
      postedAt: req.body.status === 'open' ? new Date() : null
    });

    res.status(201).json({
      success: true,
      message: 'Job posting created successfully',
      data: { job }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating job posting',
      error: error.message
    });
  }
});

// @route   PUT /api/recruitment/:id
// @desc    Update job posting
// @access  Private (HR or above)
router.put('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const job = await Recruitment.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job posting not found'
      });
    }

    // Set postedAt when status changes to open
    if (req.body.status === 'open' && job.status !== 'open') {
      req.body.postedAt = new Date();
    }

    const updatedJob = await Recruitment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('department', 'name');

    res.json({
      success: true,
      message: 'Job posting updated successfully',
      data: { job: updatedJob }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating job posting',
      error: error.message
    });
  }
});

// @route   POST /api/recruitment/:id/apply
// @desc    Apply for a job (public)
// @access  Public
router.post('/:id/apply', async (req, res) => {
  try {
    const { name, email, phone, resume, coverLetter } = req.body;

    const job = await Recruitment.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job posting not found'
      });
    }

    if (job.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'This position is no longer accepting applications'
      });
    }

    // Check if already applied
    const alreadyApplied = job.applicants.some(a => a.email === email);
    if (alreadyApplied) {
      return res.status(400).json({
        success: false,
        message: 'You have already applied for this position'
      });
    }

    job.applicants.push({
      name,
      email,
      phone,
      resume,
      coverLetter
    });
    await job.save();

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error submitting application',
      error: error.message
    });
  }
});

// @route   PUT /api/recruitment/:id/applicant/:applicantId
// @desc    Update applicant status
// @access  Private (HR or above)
router.put('/:id/applicant/:applicantId', protect, isHROrAbove, async (req, res) => {
  try {
    const { status, notes, interviewDate, rating } = req.body;

    const job = await Recruitment.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job posting not found'
      });
    }

    const applicant = job.applicants.id(req.params.applicantId);
    if (!applicant) {
      return res.status(404).json({
        success: false,
        message: 'Applicant not found'
      });
    }

    if (status) applicant.status = status;
    if (notes) applicant.notes = notes;
    if (interviewDate) applicant.interviewDate = interviewDate;
    if (rating) applicant.rating = rating;

    await job.save();

    res.json({
      success: true,
      message: 'Applicant updated successfully',
      data: { applicant }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating applicant',
      error: error.message
    });
  }
});

// @route   DELETE /api/recruitment/:id
// @desc    Close/Delete job posting
// @access  Private (HR or above)
router.delete('/:id', protect, isHROrAbove, async (req, res) => {
  try {
    const job = await Recruitment.findByIdAndUpdate(
      req.params.id,
      { status: 'closed' },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job posting not found'
      });
    }

    res.json({
      success: true,
      message: 'Job posting closed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error closing job posting',
      error: error.message
    });
  }
});

module.exports = router;

