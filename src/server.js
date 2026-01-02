require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/database');
const passport = require('./config/passport');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const employeeRoutes = require('./routes/employee.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const leaveRoutes = require('./routes/leave.routes');
const noticeRoutes = require('./routes/notice.routes');
const meetingRoutes = require('./routes/meeting.routes');
const taskRoutes = require('./routes/task.routes');
const chatRoutes = require('./routes/chat.routes');
const reportRoutes = require('./routes/report.routes');
const recruitmentRoutes = require('./routes/recruitment.routes');
const departmentRoutes = require('./routes/department.routes');

const app = express();
const server = http.createServer(app);

// Socket.io setup for real-time chat
const io = new Server(server, {
  cors: {
    origin: [
      process.env.EMPLOYEE_PORTAL_URL || 'http://localhost:5173',
      process.env.MANAGEMENT_PORTAL_URL || 'http://localhost:5174'
    ],
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({
  origin: [
    process.env.EMPLOYEE_PORTAL_URL || 'http://localhost:5173',
    process.env.MANAGEMENT_PORTAL_URL || 'http://localhost:5174'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Passport
app.use(passport.initialize());

// Make io accessible to routes
app.set('io', io);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/departments', departmentRoutes);

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Office Management API is running',
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection handling with authentication
io.use((socket, next) => {
  // Socket.io authentication middleware
  // For now, we'll allow connections and authenticate in the join event
  next();
});

io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Join user to their personal room
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`👤 User ${userId} joined their room`);
    
    // Notify others that this user is online (optional)
    socket.broadcast.emit('userOnline', { userId });
  });

  // Handle chat messages (for direct socket messaging if needed)
  socket.on('sendMessage', (data) => {
    // Emit to specific user rooms
    io.to(data.receiverId).emit('newMessage', data);
  });

  // Handle typing indicator
  socket.on('typing', (data) => {
    socket.to(data.receiverId).emit('userTyping', {
      userId: socket.id,
      chatId: data.chatId,
      isTyping: data.isTyping
    });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
    // Notify others that user is offline (optional)
    socket.broadcast.emit('userOffline', { userId: socket.id });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found' 
  });
});

const PORT = process.env.PORT || 5000;

// Connect to database and start server
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api`);
  });
});

module.exports = { app, io };

