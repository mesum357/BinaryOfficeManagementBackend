# Office Management System - Backend API

A comprehensive Node.js backend API for the Office Management System that serves both the Employee Portal and Management Portal.

## 🚀 Features

- **Authentication**: JWT-based authentication with role-based access control
- **Employee Management**: Complete CRUD operations for employee records
- **Attendance Tracking**: Check-in/out system with real-time tracking
- **Leave Management**: Leave requests, approvals, and balance tracking
- **Notice Board**: Company-wide announcements and notifications
- **Meeting Scheduler**: Meeting management with attendee tracking
- **Task Management**: Task assignment and progress tracking
- **Real-time Chat**: WebSocket-based messaging system
- **Reports & Analytics**: Comprehensive reporting dashboard
- **Recruitment**: Job posting and applicant tracking

## 📋 Prerequisites

- Node.js (v18 or higher)
- MongoDB (v6 or higher)
- npm or yarn

## 🛠️ Installation

1. **Navigate to the backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the backend directory:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/office_management
   JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
   JWT_EXPIRES_IN=7d
   EMPLOYEE_PORTAL_URL=http://localhost:5173
   MANAGEMENT_PORTAL_URL=http://localhost:5174
   ```

4. **Start MongoDB**
   
   Make sure MongoDB is running on your system.

5. **Seed the database (optional)**
   ```bash
   npm run seed
   ```
   This creates sample data including test user accounts.

6. **Start the server**
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

## 🔐 Default Test Accounts

After running the seeder, you can use these accounts:

| Role     | Email                  | Password    |
|----------|------------------------|-------------|
| Admin    | admin@company.com      | password123 |
| HR       | hr@company.com         | password123 |
| Boss     | boss@company.com       | password123 |
| Manager  | manager@company.com    | password123 |
| Employee | employee@company.com   | password123 |

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `PUT /api/auth/change-password` - Change password

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user

### Employees
- `GET /api/employees` - Get all employees
- `GET /api/employees/directory` - Get employee directory
- `GET /api/employees/stats` - Get employee statistics
- `GET /api/employees/:id` - Get employee by ID
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Deactivate employee

### Departments
- `GET /api/departments` - Get all departments
- `GET /api/departments/:id` - Get department by ID
- `POST /api/departments` - Create department
- `PUT /api/departments/:id` - Update department
- `DELETE /api/departments/:id` - Deactivate department

### Attendance
- `GET /api/attendance` - Get attendance records
- `GET /api/attendance/my` - Get current user's attendance
- `GET /api/attendance/today` - Get today's status
- `GET /api/attendance/stats` - Get attendance statistics
- `POST /api/attendance/check-in` - Check in
- `POST /api/attendance/check-out` - Check out
- `PUT /api/attendance/:id` - Update attendance record

### Leaves
- `GET /api/leaves` - Get all leave requests
- `GET /api/leaves/my` - Get current user's leaves
- `GET /api/leaves/pending` - Get pending requests
- `GET /api/leaves/balance` - Get leave balance
- `GET /api/leaves/:id` - Get leave by ID
- `POST /api/leaves` - Create leave request
- `PUT /api/leaves/:id/approve` - Approve leave
- `PUT /api/leaves/:id/reject` - Reject leave
- `PUT /api/leaves/:id/cancel` - Cancel leave

### Notices
- `GET /api/notices` - Get all notices
- `GET /api/notices/recent` - Get recent notices
- `GET /api/notices/:id` - Get notice by ID
- `POST /api/notices` - Create notice
- `PUT /api/notices/:id` - Update notice
- `PUT /api/notices/:id/acknowledge` - Acknowledge notice
- `DELETE /api/notices/:id` - Delete notice

### Meetings
- `GET /api/meetings` - Get all meetings
- `GET /api/meetings/upcoming` - Get upcoming meetings
- `GET /api/meetings/today` - Get today's meetings
- `GET /api/meetings/:id` - Get meeting by ID
- `POST /api/meetings` - Create meeting
- `PUT /api/meetings/:id` - Update meeting
- `PUT /api/meetings/:id/respond` - Respond to invitation
- `DELETE /api/meetings/:id` - Cancel meeting

### Tasks
- `GET /api/tasks` - Get all tasks
- `GET /api/tasks/my` - Get current user's tasks
- `GET /api/tasks/stats` - Get task statistics
- `GET /api/tasks/:id` - Get task by ID
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `POST /api/tasks/:id/comment` - Add comment
- `PUT /api/tasks/:id/subtask/:subtaskId` - Update subtask
- `DELETE /api/tasks/:id` - Cancel task

### Chat
- `GET /api/chat` - Get all chats
- `GET /api/chat/:id` - Get chat with messages
- `GET /api/chat/:id/messages` - Get messages (paginated)
- `POST /api/chat/private` - Create/get private chat
- `POST /api/chat/group` - Create group chat
- `POST /api/chat/:id/message` - Send message
- `PUT /api/chat/:id/group` - Update group
- `DELETE /api/chat/:id/message/:messageId` - Delete message

### Reports
- `GET /api/reports/dashboard` - Get dashboard stats
- `GET /api/reports/attendance` - Get attendance report
- `GET /api/reports/leave` - Get leave report
- `GET /api/reports/tasks` - Get task report
- `GET /api/reports/employee/:id` - Get employee report
- `GET /api/reports/department` - Get department report

### Recruitment
- `GET /api/recruitment` - Get all job postings
- `GET /api/recruitment/open` - Get open positions (public)
- `GET /api/recruitment/stats` - Get recruitment stats
- `GET /api/recruitment/:id` - Get job posting by ID
- `POST /api/recruitment` - Create job posting
- `PUT /api/recruitment/:id` - Update job posting
- `POST /api/recruitment/:id/apply` - Apply for job (public)
- `PUT /api/recruitment/:id/applicant/:applicantId` - Update applicant
- `DELETE /api/recruitment/:id` - Close job posting

## 🔌 WebSocket Events

The server uses Socket.io for real-time features:

- `join` - Join user's personal room
- `sendMessage` - Send chat message
- `newMessage` - Receive new message
- `typing` - Typing indicator
- `newNotice` - New notice notification
- `newTask` - New task notification
- `newMeeting` - New meeting notification

## 🏗️ Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── database.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── validators.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Employee.js
│   │   ├── Department.js
│   │   ├── Attendance.js
│   │   ├── Leave.js
│   │   ├── Notice.js
│   │   ├── Meeting.js
│   │   ├── Task.js
│   │   ├── Chat.js
│   │   ├── Recruitment.js
│   │   └── index.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── employee.routes.js
│   │   ├── department.routes.js
│   │   ├── attendance.routes.js
│   │   ├── leave.routes.js
│   │   ├── notice.routes.js
│   │   ├── meeting.routes.js
│   │   ├── task.routes.js
│   │   ├── chat.routes.js
│   │   ├── report.routes.js
│   │   └── recruitment.routes.js
│   ├── seeders/
│   │   └── seed.js
│   └── server.js
├── .env
├── .env.example
├── package.json
└── README.md
```

## 🛡️ Security

- JWT-based authentication
- Password hashing with bcrypt
- Role-based access control
- CORS protection
- Input validation with express-validator

## 📝 License

ISC

