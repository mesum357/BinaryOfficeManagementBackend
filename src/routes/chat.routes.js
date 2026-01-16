const express = require('express');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { protect } = require('../middleware/auth');
const { chatUpload } = require('../config/upload');
const path = require('path');

const router = express.Router();

// @route   GET /api/chat/users
// @desc    Get all users available for chat (employees + HR/boss/admin)
// @access  Private
router.get('/users', protect, async (req, res) => {
  try {
    // Get all active users (employees + HR/boss/admin)
    const allUsers = await User.find({
      isActive: true,
      verificationStatus: 'approved'
    })
      .populate({
        path: 'employee',
        select: 'firstName lastName email employeeId department designation avatar status',
        populate: { path: 'department', select: 'name' }
      })
      .select('email role employee');

    // Format users for chat
    const chatUsers = allUsers
      .filter(user => user._id.toString() !== req.user._id.toString())
      .map(user => {
        if (user.employee && user.employee.status === 'active') {
          // User with employee record
          return {
            _id: user._id,
            email: user.email,
            role: user.role,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            employeeId: user.employee.employeeId,
            department: user.employee.department,
            designation: user.employee.designation,
            avatar: user.employee.avatar,
            displayName: `${user.employee.firstName} ${user.employee.lastName}`
          };
        } else if (['hr', 'boss', 'admin'].includes(user.role)) {
          // HR/boss/admin without employee record or with inactive employee
          const emailName = user.email.split('@')[0];
          return {
            _id: user._id,
            email: user.email,
            role: user.role,
            firstName: emailName,
            lastName: '',
            displayName: emailName
          };
        }
        return null;
      })
      .filter(Boolean) // Remove nulls
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json({
      success: true,
      data: { users: chatUsers }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching chat users',
      error: error.message
    });
  }
});

// @route   GET /api/chat
// @desc    Get all chats for current user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const chats = await Chat.find({
      participants: req.user._id,
      isActive: true
    })
      .populate({
        path: 'participants',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      })
      .populate('lastMessage.sender', 'email')
      .sort({ 'lastMessage.createdAt': -1, updatedAt: -1 });

    // Calculate unread count for each chat
    const chatsWithUnread = chats.map(chat => {
      const unreadCount = chat.messages.filter(msg => {
        const senderId = typeof msg.sender === 'object' ? msg.sender._id.toString() : msg.sender.toString();
        if (senderId === req.user._id.toString()) return false; // Skip own messages

        const isRead = msg.readBy.some(
          r => r.user.toString() === req.user._id.toString()
        );
        return !isRead && !msg.isDeleted;
      }).length;

      const chatObj = chat.toObject();
      chatObj.unreadCount = unreadCount;
      return chatObj;
    });

    res.json({
      success: true,
      data: { chats: chatsWithUnread }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching chats',
      error: error.message
    });
  }
});

// @route   GET /api/chat/:id
// @desc    Get chat by ID with messages
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id)
      .populate({
        path: 'participants',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      })
      .populate('messages.sender', 'email')
      .populate('groupAdmin', 'email');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Check if user is participant
    const isParticipant = chat.participants.some(
      p => p._id.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this chat'
      });
    }

    // Mark messages as read
    if (chat.messages && chat.messages.length > 0) {
      chat.messages.forEach(msg => {
        const senderId = typeof msg.sender === 'object' ? msg.sender._id.toString() : msg.sender.toString();
        if (senderId !== req.user._id.toString()) {
          const alreadyRead = msg.readBy.some(
            r => r.user.toString() === req.user._id.toString()
          );
          if (!alreadyRead) {
            msg.readBy.push({ user: req.user._id });
          }
        }
      });
      await chat.save();
    }

    res.json({
      success: true,
      data: { chat }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching chat',
      error: error.message
    });
  }
});

// @route   GET /api/chat/:id/messages
// @desc    Get chat messages with pagination
// @access  Private
router.get('/:id/messages', protect, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Get paginated messages (newest first)
    const startIndex = (page - 1) * limit;
    const messages = chat.messages
      .filter(m => !m.isDeleted)
      .slice(-startIndex - limit, startIndex ? -startIndex : undefined)
      .reverse();

    res.json({
      success: true,
      data: {
        messages,
        hasMore: chat.messages.length > startIndex + limit
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: error.message
    });
  }
});

// @route   POST /api/chat/private
// @desc    Create or get private chat
// @access  Private
router.post('/private', protect, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Check if chat already exists
    let chat = await Chat.findOne({
      chatType: 'private',
      participants: { $all: [req.user._id, userId] }
    }).populate('participants', 'email');

    if (!chat) {
      chat = await Chat.create({
        chatType: 'private',
        participants: [req.user._id, userId]
      });
      chat = await chat.populate({
        path: 'participants',
        select: 'email role',
        populate: {
          path: 'employee',
          select: 'firstName lastName employeeId department designation avatar',
          populate: { path: 'department', select: 'name' }
        }
      });
    }

    res.json({
      success: true,
      data: { chat }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating chat',
      error: error.message
    });
  }
});

// @route   POST /api/chat/group
// @desc    Create group chat
// @access  Private
router.post('/group', protect, async (req, res) => {
  try {
    const { groupName, participants } = req.body;

    if (!groupName || !participants || participants.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Group name and at least 2 participants required'
      });
    }

    const chat = await Chat.create({
      chatType: 'group',
      groupName,
      participants: [req.user._id, ...participants],
      groupAdmin: req.user._id
    });

    await chat.populate('participants', 'email');

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { chat }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating group',
      error: error.message
    });
  }
});

// @route   POST /api/chat/upload
// @desc    Upload file/image for chat
// @access  Private
router.post('/upload', protect, chatUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const fileUrl = `/uploads/chat/${req.file.filename}`;
    const isImage = /\.(jpeg|jpg|png|gif|webp)$/i.test(req.file.originalname);

    res.json({
      success: true,
      data: {
        name: req.file.originalname,
        url: fileUrl,
        attachmentType: isImage ? 'image' : 'file',
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('[Chat Upload Error]:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
});

// @route   POST /api/chat/:id/message
// @desc    Send message
// @access  Private
router.post('/:id/message', protect, async (req, res) => {
  try {
    const { content, messageType = 'text', attachments } = req.body;

    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Check if user is participant
    const isParticipant = chat.participants.some(
      p => p.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to send messages in this chat'
      });
    }

    // Determine message type based on attachments
    let finalMessageType = messageType;
    if (attachments && attachments.length > 0) {
      const hasImage = attachments.some(att => att.type === 'image');
      finalMessageType = hasImage ? 'image' : 'file';
    } else if (!content && attachments && attachments.length > 0) {
      finalMessageType = 'file';
    }

    // Create content preview for last message
    let lastMessageContent = content || '';
    if (attachments && attachments.length > 0) {
      if (finalMessageType === 'image') {
        lastMessageContent = content || '📷 Image';
      } else {
        const firstAttachmentName = attachments[0]?.name || 'File';
        lastMessageContent = content || `📎 ${firstAttachmentName}`;
      }
    }

    const message = {
      sender: req.user._id,
      content: content || '',
      messageType: finalMessageType,
      attachments: attachments?.map(att => ({
        name: att.name,
        url: att.url,
        attachmentType: att.attachmentType || att.type, // Handle both for safety
        size: att.size
      })) || [],
      readBy: [{ user: req.user._id }]
    };

    chat.messages.push(message);
    chat.lastMessage = {
      content: lastMessageContent,
      sender: req.user._id,
      createdAt: new Date()
    };
    await chat.save();

    // Get the newly created message (last one in array)
    const lastMsg = chat.messages[chat.messages.length - 1];

    // Format response manually instead of full population if it fails
    const populatedMessage = {
      _id: lastMsg._id,
      sender: {
        _id: req.user._id,
        email: req.user.email
      },
      content: lastMsg.content,
      messageType: lastMsg.messageType,
      attachments: lastMsg.attachments,
      createdAt: lastMsg.createdAt,
      readBy: lastMsg.readBy
    };

    // Emit socket event to all participants except sender
    const io = req.app.get('io');
    if (io) {
      chat.participants.forEach(participant => {
        // Don't emit to sender - they already have the message
        if (participant.toString() !== req.user._id.toString()) {
          io.to(participant.toString()).emit('newMessage', {
            chatId: chat._id.toString(),
            message: populatedMessage
          });
        }
      });
    }

    res.json({
      success: true,
      message: 'Message sent',
      data: { message: populatedMessage }
    });
  } catch (error) {
    console.error('[Chat API Error]:', error);
    res.status(error.status || 500).json({
      success: false,
      message: 'Error sending message',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// @route   PUT /api/chat/:id/group
// @desc    Update group chat
// @access  Private (Group admin only)
router.put('/:id/group', protect, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);

    if (!chat || chat.chatType !== 'group') {
      return res.status(404).json({
        success: false,
        message: 'Group chat not found'
      });
    }

    if (chat.groupAdmin.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only group admin can update group'
      });
    }

    const { groupName, addParticipants, removeParticipants } = req.body;

    if (groupName) chat.groupName = groupName;

    if (addParticipants) {
      chat.participants.push(...addParticipants);
    }

    if (removeParticipants) {
      chat.participants = chat.participants.filter(
        p => !removeParticipants.includes(p.toString())
      );
    }

    await chat.save();

    res.json({
      success: true,
      message: 'Group updated',
      data: { chat }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating group',
      error: error.message
    });
  }
});

// @route   DELETE /api/chat/:id/message/:messageId
// @desc    Delete message
// @access  Private
router.delete('/:id/message/:messageId', protect, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const message = chat.messages.id(req.params.messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this message'
      });
    }

    message.isDeleted = true;
    message.content = 'This message was deleted';
    await chat.save();

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting message',
      error: error.message
    });
  }
});

module.exports = router;

