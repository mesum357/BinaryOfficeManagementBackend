const express = require('express');
const MessageRequest = require('../models/MessageRequest');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/message-requests
// @desc    Get all message requests for current user (incoming and outgoing)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const incomingRequests = await MessageRequest.find({
      to: req.user._id,
      status: 'pending'
    })
      .populate({
        path: 'from',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      })
      .sort({ createdAt: -1 });

    const outgoingRequests = await MessageRequest.find({
      from: req.user._id,
      status: 'pending'
    })
      .populate({
        path: 'to',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        incoming: incomingRequests,
        outgoing: outgoingRequests
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching message requests',
      error: error.message
    });
  }
});

// @route   POST /api/message-requests
// @desc    Create a message request
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID is required'
      });
    }

    // Check if user is trying to message themselves
    if (to === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send message request to yourself'
      });
    }

    // Get recipient user to check role
    const recipient = await User.findById(to);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Check if sender is employee and recipient is boss
    const isEmployeeToBoss = req.user.role === 'employee' && recipient.role === 'boss';

    // If not employee to boss, create chat directly
    if (!isEmployeeToBoss) {
      // Check if chat already exists
      let chat = await Chat.findOne({
        chatType: 'private',
        participants: { $all: [req.user._id, to] }
      });

      if (!chat) {
        chat = await Chat.create({
          chatType: 'private',
          participants: [req.user._id, to]
        });
      }

      await chat.populate({
        path: 'participants',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      });

      return res.json({
        success: true,
        data: { chat },
        message: 'Chat created successfully'
      });
    }

    // Check if there's already a pending request
    const existingRequest = await MessageRequest.findOne({
      from: req.user._id,
      to: to,
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'Message request already pending'
      });
    }

    // Check if there's already an accepted request (chat exists)
    const acceptedRequest = await MessageRequest.findOne({
      from: req.user._id,
      to: to,
      status: 'accepted'
    });

    if (acceptedRequest) {
      // Find or create chat
      let chat = await Chat.findOne({
        chatType: 'private',
        participants: { $all: [req.user._id, to] }
      });

      if (!chat) {
        chat = await Chat.create({
          chatType: 'private',
          participants: [req.user._id, to]
        });
      }

      await chat.populate({
        path: 'participants',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      });

      return res.json({
        success: true,
        data: { chat },
        message: 'Chat already exists'
      });
    }

    // Create message request
    const messageRequest = await MessageRequest.create({
      from: req.user._id,
      to: to,
      message: message || ''
    });

    await messageRequest.populate({
      path: 'from',
      select: 'email role',
      populate: {
        path: 'employee',
        select: 'firstName lastName employeeId department designation avatar',
        populate: { path: 'department', select: 'name' }
      }
    });

    await messageRequest.populate({
      path: 'to',
      select: 'email role',
      populate: {
        path: 'employee',
        select: 'firstName lastName employeeId department designation avatar',
        populate: { path: 'department', select: 'name' }
      }
    });

    // Emit socket event to notify boss
    const io = req.app.get('io');
    if (io) {
      io.to(to).emit('newMessageRequest', {
        requestId: messageRequest._id.toString(),
        from: {
          _id: req.user._id.toString(),
          email: req.user.email
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message request sent',
      data: { messageRequest }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Message request already pending'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating message request',
      error: error.message
    });
  }
});

// @route   PUT /api/message-requests/:id/accept
// @desc    Accept a message request
// @access  Private
router.put('/:id/accept', protect, async (req, res) => {
  try {
    const messageRequest = await MessageRequest.findById(req.params.id);

    if (!messageRequest) {
      return res.status(404).json({
        success: false,
        message: 'Message request not found'
      });
    }

    // Check if user is the recipient
    if (messageRequest.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to accept this request'
      });
    }

    // Check if already processed
    if (messageRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Message request has already been ${messageRequest.status}`
      });
    }

    // Update request status
    messageRequest.status = 'accepted';
    messageRequest.respondedAt = new Date();
    await messageRequest.save();

    // Create or get chat
    let chat = await Chat.findOne({
      chatType: 'private',
      participants: { $all: [messageRequest.from, messageRequest.to] }
    });

    if (!chat) {
      chat = await Chat.create({
        chatType: 'private',
        participants: [messageRequest.from, messageRequest.to]
      });
    }

    await chat.populate({
      path: 'participants',
      select: 'email role',
      populate: {
        path: 'employee',
        select: 'firstName lastName employeeId department designation avatar',
        populate: { path: 'department', select: 'name' }
      }
    });

    // Emit socket event to notify requester
    const io = req.app.get('io');
    if (io) {
      io.to(messageRequest.from.toString()).emit('messageRequestAccepted', {
        requestId: messageRequest._id.toString(),
        chatId: chat._id.toString()
      });
    }

    res.json({
      success: true,
      message: 'Message request accepted',
      data: { chat, messageRequest }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error accepting message request',
      error: error.message
    });
  }
});

// @route   PUT /api/message-requests/:id/reject
// @desc    Reject a message request
// @access  Private
router.put('/:id/reject', protect, async (req, res) => {
  try {
    const messageRequest = await MessageRequest.findById(req.params.id);

    if (!messageRequest) {
      return res.status(404).json({
        success: false,
        message: 'Message request not found'
      });
    }

    // Check if user is the recipient
    if (messageRequest.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reject this request'
      });
    }

    // Check if already processed
    if (messageRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Message request has already been ${messageRequest.status}`
      });
    }

    // Update request status
    messageRequest.status = 'rejected';
    messageRequest.respondedAt = new Date();
    await messageRequest.save();

    // Emit socket event to notify requester
    const io = req.app.get('io');
    if (io) {
      io.to(messageRequest.from.toString()).emit('messageRequestRejected', {
        requestId: messageRequest._id.toString()
      });
    }

    res.json({
      success: true,
      message: 'Message request rejected',
      data: { messageRequest }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting message request',
      error: error.message
    });
  }
});

module.exports = router;

