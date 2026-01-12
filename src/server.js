require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const path = require('path');
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
const ticketRoutes = require('./routes/ticket.routes');
const chatRoutes = require('./routes/chat.routes');
const messageRequestRoutes = require('./routes/messageRequest.routes');
const reportRoutes = require('./routes/report.routes');
const recruitmentRoutes = require('./routes/recruitment.routes');
const departmentRoutes = require('./routes/department.routes');
const settingsRoutes = require('./routes/settings.routes');

const app = express();
const server = http.createServer(app);

// Socket.io setup for real-time chat
const io = new Server(server, {
  cors: {
    origin: [
      process.env.EMPLOYEE_PORTAL_URL || 'http://localhost:5173',
      process.env.MANAGEMENT_PORTAL_URL || 'http://localhost:5174',
      'https://employee-website-dkq3.onrender.com',
      'https://management-website-mu6q.onrender.com'
    ],
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(compression()); // Compress responses for faster transfer
app.use(cors({
  origin: [
    process.env.EMPLOYEE_PORTAL_URL || 'http://localhost:5173',
    process.env.MANAGEMENT_PORTAL_URL || 'http://localhost:5174',
    'https://employee-website-dkq3.onrender.com',
    'https://management-website-mu6q.onrender.com'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialize Passport
app.use(passport.initialize());

// Make io accessible to routes
app.set('io', io);

// API Routes
console.log('[SERVER] Loading auth routes...');

// Debug: Log all routes from auth router BEFORE mounting
console.log('[SERVER] Auth router type:', typeof authRoutes);
console.log('[SERVER] Auth router has stack:', authRoutes && typeof authRoutes.stack !== 'undefined');

if (authRoutes && authRoutes.stack) {
  console.log('[SERVER] Auth routes in router (before mounting):');
  authRoutes.stack.forEach((middleware, index) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
      console.log(`  [${index}] ${methods} /api/auth${middleware.route.path}`);
    } else if (middleware.name !== '<anonymous>') {
      console.log(`  [${index}] Middleware: ${middleware.name || 'anonymous'}`);
    }
  });
  console.log('[SERVER] Total middleware in auth router:', authRoutes.stack.length);
}

app.use('/api/auth', (req, res, next) => {
  console.log(`[AUTH MIDDLEWARE] ${req.method} ${req.path}`);
  next();
}, authRoutes);

console.log('[SERVER] Auth routes mounted at /api/auth');
app.use('/api/users', userRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/message-requests', messageRequestRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/settings', settingsRoutes);

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

// 404 handler with debugging
app.use((req, res) => {
  console.log('[404 HANDLER] Route not found:', req.method, req.path);
  console.log('[404 HANDLER] Available routes:', req.app._router?.stack?.length || 'unknown');
  res.status(404).json({ 
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method
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

