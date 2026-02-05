require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { Task } = require('../models');

const removeMockTasks = async () => {
  try {
    await connectDB();
    console.log('🔌 Connected to MongoDB');

    // List of mock task titles to remove
    const mockTaskTitles = [
      'Website Redesign',
      'Update Employee Handbook',
      'Complete Q4 Report'
    ];

    // Find and delete tasks with these titles
    const result = await Task.deleteMany({
      title: { $in: mockTaskTitles }
    });

    console.log(`✅ Removed ${result.deletedCount} mock task(s) from database`);
    console.log('📋 Removed tasks:');
    mockTaskTitles.forEach(title => {
      console.log(`   - ${title}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error removing mock tasks:', error);
    process.exit(1);
  }
};

removeMockTasks();

