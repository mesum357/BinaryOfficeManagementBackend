require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/database');
const { User, Employee, Department, Attendance, Leave, Notice, Meeting, Task } = require('../models');

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log('🌱 Starting database seeding...');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Employee.deleteMany({}),
      Department.deleteMany({}),
      Attendance.deleteMany({}),
      Leave.deleteMany({}),
      Notice.deleteMany({}),
      Meeting.deleteMany({}),
      Task.deleteMany({})
    ]);
    console.log('✅ Cleared existing data');

    // Create Departments
    const departments = await Department.insertMany([
      { name: 'Human Resources', code: 'HR', description: 'Human Resources Department' },
      { name: 'Engineering', code: 'ENG', description: 'Software Engineering Department' },
      { name: 'Marketing', code: 'MKT', description: 'Marketing and Sales Department' },
      { name: 'Finance', code: 'FIN', description: 'Finance and Accounting Department' },
      { name: 'Operations', code: 'OPS', description: 'Operations and Administration' },
      { name: 'Employee', code: 'EMP', description: 'General Employee Department' },
      { name: 'Student', code: 'STU', description: 'Student Program Department' },
      { name: 'Intern', code: 'INT', description: 'Internship Program Department' }
    ]);
    console.log('✅ Created departments');

    // Create Employees
    const employees = await Employee.insertMany([
      {
        employeeId: 'EMP0001',
        firstName: 'Founder',
        lastName: 'User',
        email: 'admin@bms.com',
        phone: '03001234567',
        department: departments[0]._id,
        designation: 'Founder',
        dateOfJoining: new Date('2020-01-01'),
        gender: 'male',
        status: 'active'
      },
      {
        employeeId: 'EMP0002',
        firstName: 'Sarah',
        lastName: 'Khan',
        email: 'hr@bms.com',
        phone: '03001234568',
        department: departments[0]._id,
        designation: 'HR Manager',
        dateOfJoining: new Date('2021-03-15'),
        gender: 'female',
        status: 'active'
      },
      {
        employeeId: 'EMP0003',
        firstName: 'CEO',
        lastName: 'User',
        email: 'ceo@bms.com',
        phone: '03001234569',
        department: departments[4]._id,
        designation: 'CEO',
        dateOfJoining: new Date('2019-01-01'),
        gender: 'male',
        status: 'active'
      },
      {
        employeeId: 'EMP0004',
        firstName: 'Fatima',
        lastName: 'Malik',
        email: 'manager@company.com',
        phone: '03001234570',
        department: departments[1]._id,
        designation: 'Engineering Manager',
        dateOfJoining: new Date('2020-06-01'),
        gender: 'female',
        status: 'active'
      },
      {
        employeeId: 'EMP0005',
        firstName: 'Ali',
        lastName: 'Hassan',
        email: 'employee@company.com',
        phone: '03001234571',
        department: departments[1]._id,
        designation: 'Software Developer',
        dateOfJoining: new Date('2022-01-10'),
        gender: 'male',
        status: 'active'
      },
      {
        employeeId: 'EMP0006',
        firstName: 'Ayesha',
        lastName: 'Siddiqui',
        email: 'ayesha@company.com',
        phone: '03001234572',
        department: departments[2]._id,
        designation: 'Marketing Executive',
        dateOfJoining: new Date('2022-04-01'),
        gender: 'female',
        status: 'active'
      },
      {
        employeeId: 'EMP0007',
        firstName: 'Usman',
        lastName: 'Ahmed',
        email: 'usman@company.com',
        phone: '03001234573',
        department: departments[3]._id,
        designation: 'Accountant',
        dateOfJoining: new Date('2021-08-15'),
        gender: 'male',
        status: 'active'
      }
    ]);
    console.log('✅ Created employees');

    // Update department heads
    await Department.findByIdAndUpdate(departments[0]._id, { head: employees[1]._id });
    await Department.findByIdAndUpdate(departments[1]._id, { head: employees[3]._id });

    // Create or update Users with hashed passwords
    // Delete existing seed users first to ensure clean state
    await User.deleteMany({
      email: {
        $in: [
          'admin@bms.com',
          'hr@bms.com',
          'ceo@bms.com',
          'manager@company.com',
          'employee@company.com',
          'ayesha@company.com',
          'usman@company.com'
        ]
      }
    });

    // Create users using create() to ensure pre-save hook runs and password is hashed
    const users = [];
    const userData = [
      {
        email: 'admin@bms.com',
        password: 'password123', // Will be hashed by pre-save hook
        role: 'admin',
        employee: employees[0]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'hr@bms.com',
        password: 'password123',
        role: 'hr',
        employee: employees[1]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'ceo@bms.com',
        password: 'password123',
        role: 'boss',
        employee: employees[2]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'manager@company.com',
        password: 'password123',
        role: 'manager',
        employee: employees[3]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'employee@company.com',
        password: 'password123',
        role: 'employee',
        employee: employees[4]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'ayesha@company.com',
        password: 'password123',
        role: 'employee',
        employee: employees[5]._id,
        verificationStatus: 'approved',
        isActive: true
      },
      {
        email: 'usman@company.com',
        password: 'password123',
        role: 'employee',
        employee: employees[6]._id,
        verificationStatus: 'approved',
        isActive: true
      }
    ];

    for (const userInfo of userData) {
      const user = await User.create(userInfo);
      users.push(user);
    }
    console.log('✅ Created users');

    // Create sample Notices
    await Notice.insertMany([
      {
        title: 'Welcome to the New Office Management System',
        content: 'We are excited to announce the launch of our new office management system. This system will help streamline our daily operations.',
        category: 'general',
        priority: 'high',
        targetAudience: 'all',
        publishedBy: users[1]._id,
        isPinned: true
      },
      {
        title: 'Holiday Notice - Eid ul Fitr',
        content: 'Office will remain closed on the occasion of Eid ul Fitr. Dates will be announced soon.',
        category: 'holiday',
        priority: 'medium',
        targetAudience: 'all',
        publishedBy: users[1]._id
      },
      {
        title: 'New Leave Policy Update',
        content: 'Please review the updated leave policy effective from next month. Key changes include increased annual leave days.',
        category: 'policy',
        priority: 'high',
        targetAudience: 'all',
        publishedBy: users[1]._id,
        acknowledgementRequired: true
      }
    ]);
    console.log('✅ Created notices');

    // Create sample Tasks - Removed mock tasks
    // Tasks will be created through the application UI
    console.log('✅ Tasks section skipped (use application UI to create tasks)');

    // Create sample Meetings
    await Meeting.insertMany([
      {
        title: 'Weekly Team Standup',
        description: 'Weekly progress update meeting',
        organizer: users[3]._id,
        attendees: [
          { employee: employees[4]._id, status: 'accepted' }
        ],
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        location: 'Conference Room A',
        meetingType: 'in-person',
        status: 'scheduled',
        recurrence: 'weekly'
      },
      {
        title: 'Quarterly Review',
        description: 'Q4 performance review meeting',
        organizer: users[2]._id,
        attendees: [
          { employee: employees[1]._id, status: 'pending' },
          { employee: employees[3]._id, status: 'pending' }
        ],
        startTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
        location: 'Board Room',
        meetingType: 'in-person',
        status: 'scheduled'
      }
    ]);
    console.log('✅ Created meetings');

    // Create today's attendance for some employees
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Attendance.insertMany([
      {
        employee: employees[0]._id,
        date: today,
        checkIn: { time: new Date(today.getTime() + 9 * 60 * 60 * 1000) },
        status: 'present'
      },
      {
        employee: employees[1]._id,
        date: today,
        checkIn: { time: new Date(today.getTime() + 8.5 * 60 * 60 * 1000) },
        status: 'present'
      },
      {
        employee: employees[4]._id,
        date: today,
        checkIn: { time: new Date(today.getTime() + 9.5 * 60 * 60 * 1000) },
        status: 'late'
      }
    ]);
    console.log('✅ Created sample attendance');

    console.log('\n🎉 Database seeding completed successfully!\n');
    console.log('📋 Test Accounts:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Founder:  admin@bms.com    / password123');
    console.log('HR:       hr@bms.com       / password123');
    console.log('CEO:      ceo@bms.com      / password123');
    console.log('Manager:  manager@company.com  / password123');
    console.log('Employee: employee@company.com / password123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedDatabase();

