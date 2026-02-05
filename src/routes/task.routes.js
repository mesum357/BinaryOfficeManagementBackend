const express = require('express');
const path = require('path');
const Task = require('../models/Task');
const { protect, isManagerOrAbove, isBossOrAdmin } = require('../middleware/auth');
const { taskValidator } = require('../middleware/validators');
const { upload } = require('../config/upload');

const router = express.Router();

// @route   GET /api/tasks
// @desc    Get all tasks
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const {
      status,
      priority,
      assignedTo,
      department,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Filter tasks for non-managers
    // HR should be able to view all tasks in HR portal as well.
    if (!['hr', 'manager', 'boss', 'admin'].includes(req.user.role)) {
      query.$or = [
        { assignedBy: req.user._id },
        { assignedTo: req.user.employee }
      ];
    } else {
      if (assignedTo) query.assignedTo = assignedTo;
    }

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (department) query.department = department;

    const tasks = await Task.find(query)
      .populate('assignedBy', 'email')
      .populate('assignedTo', 'firstName lastName employeeId')
      .populate('department', 'name')
      .populate('attachments.uploadedBy', 'email')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ dueDate: 1, priority: -1 });

    const total = await Task.countDocuments(query);

    res.json({
      success: true,
      data: {
        tasks,
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
      message: 'Error fetching tasks',
      error: error.message
    });
  }
});

// @route   GET /api/tasks/my
// @desc    Get current user's tasks
// @access  Private
router.get('/my', protect, async (req, res) => {
  try {
    const { status } = req.query;

    const query = { assignedTo: req.user.employee };
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .populate('assignedBy', 'email')
      .populate('department', 'name')
      .select('-__v')
      .sort({ dueDate: 1, priority: -1 })
      .lean();

    // Group by status
    const tasksByStatus = {
      pending: tasks.filter(t => t.status === 'pending'),
      inProgress: tasks.filter(t => t.status === 'in-progress'),
      completed: tasks.filter(t => t.status === 'completed'),
      overdue: tasks.filter(t => t.status !== 'completed' && new Date(t.dueDate) < new Date())
    };

    res.json({
      success: true,
      data: { tasks, tasksByStatus }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching tasks',
      error: error.message
    });
  }
});

// @route   GET /api/tasks/stats
// @desc    Get task statistics
// @access  Private (Manager or above)
router.get('/stats', protect, isManagerOrAbove, async (req, res) => {
  try {
    const stats = await Task.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const priorityStats = await Task.aggregate([
      { $match: { status: { $ne: 'completed' } } },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    const overdueTasks = await Task.countDocuments({
      status: { $nin: ['completed', 'cancelled'] },
      dueDate: { $lt: new Date() }
    });

    res.json({
      success: true,
      data: { stats, priorityStats, overdueTasks }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching task stats',
      error: error.message
    });
  }
});

// @route   GET /api/tasks/:id
// @desc    Get task by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedBy', 'email')
      .populate('assignedTo', 'firstName lastName employeeId email')
      .populate('department', 'name')
      .populate('comments.user', 'email')
      .populate('parentTask', 'title');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      data: { task }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching task',
      error: error.message
    });
  }
});

// @route   POST /api/tasks
// @desc    Create task
// @access  Private (Boss or Admin only)
router.post('/', protect, isBossOrAdmin, taskValidator, async (req, res) => {
  try {
    const task = await Task.create({
      ...req.body,
      assignedBy: req.user._id
    });

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io && req.body.assignedTo) {
      req.body.assignedTo.forEach(empId => {
        io.to(empId).emit('newTask', {
          id: task._id,
          title: task.title,
          priority: task.priority,
          dueDate: task.dueDate
        });
      });
    }

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: { task }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating task',
      error: error.message
    });
  }
});

// @route   PUT /api/tasks/:id
// @desc    Update task
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check permissions
    const isAssigner = task.assignedBy.toString() === req.user._id.toString();

    // Check if user is an assignee - handle both ObjectId and populated cases
    let userEmployeeId = null;
    if (req.user.employee) {
      // Handle both populated object and ObjectId
      userEmployeeId = req.user.employee._id
        ? req.user.employee._id.toString()
        : req.user.employee.toString();
    }

    const isAssignee = userEmployeeId && task.assignedTo.some(
      (e) => {
        // Handle both ObjectId and populated employee object
        const employeeId = e._id ? e._id.toString() : e.toString();
        return employeeId === userEmployeeId;
      }
    );

    const isManager = ['hr', 'manager', 'boss', 'admin'].includes(req.user.role);

    if (!isAssigner && !isAssignee && !isManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this task. You must be assigned to this task, the task creator, or a manager.'
      });
    }

    // Assignees can only update status, progress, submissionDescription, and attachments
    let updateData = req.body;
    if (!isAssigner && !isManager) {
      const { status, progress, actualHours, submissionDescription, attachments } = req.body;
      updateData = { status, progress, actualHours };

      // Allow submission description and attachments when submitting
      if (submissionDescription !== undefined) {
        updateData.submissionDescription = submissionDescription;
        updateData.submissionDate = new Date();
      }

      if (attachments && Array.isArray(attachments)) {
        // Add new attachments to existing ones
        const existingAttachments = task.attachments || [];
        updateData.attachments = [...existingAttachments, ...attachments.map(att => ({
          name: att.name,
          url: att.url,
          uploadedBy: req.user._id,
          uploadedAt: new Date()
        }))];
      }

      if (status === 'completed') {
        updateData.completedDate = new Date();
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('assignedTo', 'firstName lastName employeeId')
      .populate('assignedBy', 'email');

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: { task: updatedTask }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating task',
      error: error.message
    });
  }
});

// @route   POST /api/tasks/:id/upload
// @desc    Upload image for task submission
// @access  Private
router.post('/:id/upload', protect, upload.single('image'), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check if user is assignee
    const userEmployeeId = req.user.employee
      ? (req.user.employee._id ? req.user.employee._id.toString() : req.user.employee.toString())
      : null;

    const isAssignee = userEmployeeId && task.assignedTo.some(
      (e) => {
        const employeeId = e._id ? e._id.toString() : e.toString();
        return employeeId === userEmployeeId;
      }
    );

    if (!isAssignee) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload images for this task'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Add attachment to task
    const fileUrl = `/uploads/tasks/${req.file.filename}`;
    task.attachments.push({
      name: req.file.originalname,
      url: fileUrl,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    });
    await task.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        attachment: {
          name: req.file.originalname,
          url: fileUrl,
          uploadedAt: new Date()
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error uploading image',
      error: error.message
    });
  }
});

// @route   POST /api/tasks/:id/comment
// @desc    Add comment to task
// @access  Private
router.post('/:id/comment', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    task.comments.push({
      user: req.user._id,
      content: req.body.content
    });
    await task.save();

    res.json({
      success: true,
      message: 'Comment added',
      data: { task }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error adding comment',
      error: error.message
    });
  }
});

// @route   PUT /api/tasks/:id/subtask/:subtaskId
// @desc    Update subtask
// @access  Private
router.put('/:id/subtask/:subtaskId', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const subtask = task.subtasks.id(req.params.subtaskId);
    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found'
      });
    }

    subtask.isCompleted = req.body.isCompleted;
    if (req.body.isCompleted) {
      subtask.completedAt = new Date();
    }
    await task.save();

    // Update task progress based on subtasks
    const completedSubtasks = task.subtasks.filter(s => s.isCompleted).length;
    task.progress = Math.round((completedSubtasks / task.subtasks.length) * 100);
    await task.save();

    res.json({
      success: true,
      message: 'Subtask updated',
      data: { task }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating subtask',
      error: error.message
    });
  }
});

// @route   DELETE /api/tasks/:id
// @desc    Delete/Cancel task
// @access  Private (Assigner or Manager+)
router.delete('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const isAssigner = task.assignedBy.toString() === req.user._id.toString();
    const isBoss = ['boss', 'admin'].includes(req.user.role);

    if (!isAssigner && !isBoss) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this task. Only the task creator or boss/admin can delete tasks.'
      });
    }

    // Delete task permanently
    await Task.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Task deleted permanently'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting task',
      error: error.message
    });
  }
});

module.exports = router;

