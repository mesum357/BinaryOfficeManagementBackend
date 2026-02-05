require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { User, Employee, Department } = require('../models');

const initAdminUsers = async () => {
  try {
    await connectDB();
    console.log('🌱 Initializing admin users...\n');

    // Check if users already exist
    const existingUsers = await User.find({
      email: { $in: ['admin@bms.com', 'ceo@bms.com', 'hr@bms.com'] }
    });

    if (existingUsers.length > 0) {
      console.log('⚠️  Some users already exist. Deleting existing admin users...');
      await User.deleteMany({
        email: { $in: ['admin@bms.com', 'ceo@bms.com', 'hr@bms.com'] }
      });
      console.log('✅ Deleted existing admin users');
    }

    // Find or create necessary departments
    let hrDept = await Department.findOne({ code: 'HR' });
    if (!hrDept) {
      hrDept = await Department.create({
        name: 'Human Resources',
        code: 'HR',
        description: 'Human Resources Department',
        isActive: true
      });
      console.log('✅ Created HR department');
    }

    let opsDept = await Department.findOne({ code: 'OPS' });
    if (!opsDept) {
      opsDept = await Department.create({
        name: 'Operations',
        code: 'OPS',
        description: 'Operations and Administration',
        isActive: true
      });
      console.log('✅ Created Operations department');
    }

    // Delete existing employees for these emails if they exist
    const existingEmployees = await Employee.find({
      email: { $in: ['admin@bms.com', 'ceo@bms.com', 'hr@bms.com'] }
    });

    if (existingEmployees.length > 0) {
      await Employee.deleteMany({
        email: { $in: ['admin@bms.com', 'ceo@bms.com', 'hr@bms.com'] }
      });
      console.log('✅ Deleted existing employees');
    }

    // Create Employees
    const adminEmployee = await Employee.create({
      employeeId: 'EMP0001',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@bms.com',
      phone: '03001234567',
      department: hrDept._id,
      designation: 'System Administrator',
      dateOfJoining: new Date('2020-01-01'),
      gender: 'male',
      status: 'active'
    });

    const ceoEmployee = await Employee.create({
      employeeId: 'EMP0002',
      firstName: 'CEO',
      lastName: 'User',
      email: 'ceo@bms.com',
      phone: '03001234568',
      department: opsDept._id,
      designation: 'Chief Executive Officer',
      dateOfJoining: new Date('2019-01-01'),
      gender: 'male',
      status: 'active'
    });

    const hrEmployee = await Employee.create({
      employeeId: 'EMP0003',
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr@bms.com',
      phone: '03001234569',
      department: hrDept._id,
      designation: 'HR Manager',
      dateOfJoining: new Date('2021-03-15'),
      gender: 'female',
      status: 'active'
    });

    console.log('✅ Created employees');

    // Set HR department head
    await Department.findByIdAndUpdate(hrDept._id, { head: hrEmployee._id });

    // Create Users
    const adminUser = await User.create({
      email: 'admin@bms.com',
      password: 'password123', // Will be hashed by pre-save hook
      role: 'admin',
      employee: adminEmployee._id,
      verificationStatus: 'approved',
      isActive: true
    });

    const ceoUser = await User.create({
      email: 'ceo@bms.com',
      password: 'password123', // Will be hashed by pre-save hook
      role: 'boss',
      employee: ceoEmployee._id,
      verificationStatus: 'approved',
      isActive: true
    });

    const hrUser = await User.create({
      email: 'hr@bms.com',
      password: 'password123', // Will be hashed by pre-save hook
      role: 'hr',
      employee: hrEmployee._id,
      verificationStatus: 'approved',
      isActive: true
    });

    console.log('✅ Created users\n');

    console.log('🎉 Admin users initialization completed successfully!\n');
    console.log('📋 Management Website Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin: admin@bms.com    / password123');
    console.log('CEO:   ceo@bms.com     / password123');
    console.log('HR:    hr@bms.com      / password123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
};

initAdminUsers();
