const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Department = require('../models/Department');
const { protect, isHROrAbove } = require('../middleware/auth');
const { loginValidator } = require('../middleware/validators');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Temporary in-memory store for WebAuthn challenges (in production, use Redis)
// Key: challenge, Value: { userId, timestamp }
const challengeStore = new Map();

// Clean up old challenges every 5 minutes
setInterval(() => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  for (const [challenge, data] of challengeStore.entries()) {
    if (now - data.timestamp > fiveMinutes) {
      challengeStore.delete(challenge);
    }
  }
}, 5 * 60 * 1000);

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Registration validator
const registerValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('department').notEmpty().withMessage('Department is required'),
  body('designation').notEmpty().withMessage('Designation is required'),
];

// @route   POST /api/auth/register
// @desc    Register new employee (pending verification)
// @access  Public
router.post('/register', registerValidator, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      department,
      designation,
      dateOfBirth,
      gender,
      address
    } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Validate department - accept both ObjectId and string name
    let dept;
    const mongoose = require('mongoose');

    // List of valid department names for sign-up
    const validDepartments = ['Backend', 'Sales'];

    if (mongoose.Types.ObjectId.isValid(department)) {
      dept = await Department.findById(department);
    } else {
      // Check if it's a valid department name
      const isValidName = validDepartments.some(d => d.toLowerCase() === department.toLowerCase());
      if (isValidName) {
        // Try to find existing department or create one
        dept = await Department.findOne({
          name: { $regex: new RegExp(`^${department}$`, 'i') }
        });

        // If department doesn't exist, create it
        if (!dept) {
          dept = await Department.create({
            name: department,
            code: department.toUpperCase().replace(/\s+/g, '_').substring(0, 3),
            description: `${department} Department`,
            isActive: true
          });
        }
      }
    }

    if (!dept) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department selected. Valid options: ' + validDepartments.join(', ')
      });
    }

    // Use the actual department ID
    const departmentId = dept._id;

    // Generate unique employeeId by finding the highest existing ID
    const employees = await Employee.find({}, { employeeId: 1 });
    let maxId = 0;
    for (const emp of employees) {
      if (emp.employeeId) {
        const idNum = parseInt(emp.employeeId.replace('EMP', ''), 10);
        if (!isNaN(idNum) && idNum > maxId) {
          maxId = idNum;
        }
      }
    }
    const employeeId = `EMP${String(maxId + 1).padStart(4, '0')}`;

    // Create employee record with pending status
    const employee = await Employee.create({
      employeeId,
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      department: departmentId,
      designation,
      dateOfBirth,
      gender,
      address,
      dateOfJoining: new Date(),
      status: 'pending' // Employee starts as pending
    });

    // Create user with pending verification
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      role: 'employee',
      employee: employee._id,
      verificationStatus: 'pending',
      isActive: false // Not active until approved
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Your account has been sent for verification. You will be notified once approved.',
      data: {
        email: user.email,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user using Passport.js
// @access  Public
router.post('/login', (req, res, next) => {
  console.log('[Auth Route] Login request received', {
    email: req.body.email,
    hasPassword: !!req.body.password
  });

  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) {
      console.error('[Auth Route] Authentication error', err);
      return res.status(500).json({
        success: false,
        message: 'Authentication error',
        error: err.message
      });
    }

    if (!user) {
      console.log('[Auth Route] Authentication failed', {
        message: info?.message,
        code: info?.code
      });
      return res.status(401).json({
        success: false,
        message: info?.message || 'Invalid credentials',
        code: info?.code
      });
    }

    console.log('[Auth Route] Authentication successful', {
      userId: user._id,
      email: user.email,
      role: user.role
    });

    // Update last login
    user.lastLogin = new Date();
    user.save({ validateBeforeSave: false });

    // Generate token
    const token = generateToken(user._id);
    console.log('[Auth Route] Token generated', { hasToken: !!token });

    const response = {
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          verificationStatus: user.verificationStatus,
          employee: user.employee ? {
            id: user.employee._id,
            employeeId: user.employee.employeeId,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            fullName: user.employee.fullName,
            avatar: user.employee.avatar,
            department: user.employee.department,
            designation: user.employee.designation
          } : null
        }
      }
    };

    console.log('[Auth Route] Sending success response', {
      hasToken: !!response.data.token,
      userRole: response.data.user.role
    });

    res.json(response);
  })(req, res, next);
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'employee',
      populate: { path: 'department' }
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          verificationStatus: user.verificationStatus,
          employee: user.employee
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message
    });
  }
});

// @route   GET /api/auth/pending-registrations
// @desc    Get all pending employee registrations
// @access  Private (HR or above)
router.get('/pending-registrations', protect, isHROrAbove, async (req, res) => {
  try {
    const pendingUsers = await User.find({ verificationStatus: 'pending' })
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name code' }
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        pendingRegistrations: pendingUsers.map(user => ({
          userId: user._id,
          email: user.email,
          createdAt: user.createdAt,
          employee: user.employee
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching pending registrations',
      error: error.message
    });
  }
});

// @route   PUT /api/auth/approve/:userId
// @desc    Approve employee registration
// @access  Private (HR or above)
router.put('/approve/:userId', protect, isHROrAbove, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.verificationStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This registration has already been processed'
      });
    }

    // Approve the user
    user.verificationStatus = 'approved';
    user.isActive = true;
    user.verifiedBy = req.user._id;
    user.verifiedAt = new Date();
    await user.save();

    // Update employee status to active
    await Employee.findByIdAndUpdate(user.employee, { status: 'active' });

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io) {
      io.emit('registrationApproved', { userId: user._id, email: user.email });
    }

    res.json({
      success: true,
      message: 'Employee registration approved successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error approving registration',
      error: error.message
    });
  }
});

// @route   PUT /api/auth/reject/:userId
// @desc    Reject employee registration
// @access  Private (HR or above)
router.put('/reject/:userId', protect, isHROrAbove, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.verificationStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This registration has already been processed'
      });
    }

    // Reject the user
    user.verificationStatus = 'rejected';
    user.isActive = false;
    user.verifiedBy = req.user._id;
    user.verifiedAt = new Date();
    user.rejectionReason = reason || 'Registration rejected by admin';
    await user.save();

    // Update employee status to rejected
    await Employee.findByIdAndUpdate(user.employee, { status: 'rejected' });

    res.json({
      success: true,
      message: 'Employee registration rejected',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting registration',
      error: error.message
    });
  }
});

// @route   GET /api/auth/registration-stats
// @desc    Get registration statistics
// @access  Private (HR or above)
router.get('/registration-stats', protect, isHROrAbove, async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$verificationStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    const statsMap = {
      pending: 0,
      approved: 0,
      rejected: 0
    };

    stats.forEach(s => {
      statsMap[s._id] = s.count;
    });

    res.json({
      success: true,
      data: { stats: statsMap }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching registration stats',
      error: error.message
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @route   PUT /api/auth/change-password
// @desc    Change password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
});

// @route   GET /api/auth/check-status/:email
// @desc    Check registration status by email
// @access  Public
router.get('/check-status/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email.toLowerCase() })
      .select('verificationStatus rejectionReason createdAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No registration found with this email'
      });
    }

    res.json({
      success: true,
      data: {
        status: user.verificationStatus,
        rejectionReason: user.rejectionReason,
        registeredAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking status',
      error: error.message
    });
  }
});

// WebAuthn / Fingerprint Authentication Routes
const { generateRegistrationOptions, verifyRegistrationResponse } = require('@simplewebauthn/server');
const { generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { isoBase64URL, isoUint8Array } = require('@simplewebauthn/server/helpers');

// RP ID - should match your domain (localhost for dev, your domain for production)
const rpName = process.env.WEBAUTHN_RP_NAME || 'Office Management System';

// Helper function to get RP ID from request origin
const getRPID = (req) => {
  // Check if RP ID is set in environment
  if (process.env.WEBAUTHN_RP_ID) {
    return process.env.WEBAUTHN_RP_ID;
  }

  // Get origin from request headers
  const origin = req.headers.origin || req.headers.referer;

  if (origin) {
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // For localhost, use localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'localhost';
      }

      // For production, extract domain (remove port and www)
      // e.g., https://employee-website-dkq3.onrender.com -> employee-website-dkq3.onrender.com
      return hostname.replace(/^www\./, '');
    } catch (e) {
      console.error('Error parsing origin:', e);
    }
  }

  // Fallback to localhost for development
  return 'localhost';
};

// Helper function to get origin from request
const getOrigin = (req) => {
  if (process.env.WEBAUTHN_ORIGIN) {
    return process.env.WEBAUTHN_ORIGIN;
  }

  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const url = new URL(origin);
      return url.origin;
    } catch (e) {
      console.error('Error parsing origin:', e);
    }
  }

  // Fallback
  return process.env.NODE_ENV === 'production'
    ? 'https://localhost'
    : 'http://localhost:5173';
};

// @route   POST /api/auth/webauthn/register/start
// @desc    Start WebAuthn registration process
// @access  Private
router.post('/webauthn/register/start', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('webauthnCredentials email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get RP ID and origin from request
    const rpID = getRPID(req);
    const origin = getOrigin(req);

    // Exclude existing credential IDs (convert from base64url to buffer)
    const excludeCredentials = (user.webauthnCredentials || []).map(cred => ({
      id: isoBase64URL.toBuffer(cred.credentialId),
      type: 'public-key',
      transports: ['usb', 'nfc', 'ble', 'internal']
    }));

    const registrationOpts = {
      rpName,
      rpID,
      origin,
      userName: user.email,
      userDisplayName: user.email,
      timeout: 60000,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // For fingerprint/Touch ID/Windows Hello
        userVerification: 'required', // Require biometric authentication during registration
        requireResidentKey: true, // Enable usernameless login (resident key/discoverable credential)
        residentKey: 'required' // Required for usernameless authentication
      },
      supportedAlgorithmIDs: [-7, -257] // ES256 and RS256
    };

    // Only include excludeCredentials if there are existing credentials
    if (excludeCredentials.length > 0) {
      registrationOpts.excludeCredentials = excludeCredentials;
    }

    const options = await generateRegistrationOptions(registrationOpts);

    // Validate options before proceeding
    if (!options || !options.challenge) {
      console.error('Invalid options generated:', options);
      return res.status(500).json({
        success: false,
        message: 'Error generating registration options: Invalid response'
      });
    }

    // Store challenge temporarily in user session or cache
    // For simplicity, we'll store it in the user document temporarily
    // In production, use Redis or similar
    user.webauthnRegistrationChallenge = options.challenge;
    await user.save();

    console.log('Registration options generated successfully for user:', user.email);
    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('WebAuthn registration start error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting fingerprint registration',
      error: error.message
    });
  }
});

// @route   POST /api/auth/webauthn/register/complete
// @desc    Complete WebAuthn registration
// @access  Private
router.post('/webauthn/register/complete', protect, async (req, res) => {
  try {
    const { deviceName, credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Credential is required'
      });
    }

    const user = await User.findById(req.user._id).select('webauthnCredentials webauthnRegistrationChallenge');

    if (!user || !user.webauthnRegistrationChallenge) {
      return res.status(400).json({
        success: false,
        message: 'Registration session expired. Please try again.'
      });
    }

    // Get the actual origin and RP ID from the request
    const requestOrigin = getOrigin(req);
    const requestRPID = getRPID(req);

    console.log('Verifying credential for user:', user._id);
    console.log('Credential structure:', JSON.stringify(credential, null, 2).substring(0, 500));
    console.log('Expected challenge:', user.webauthnRegistrationChallenge);
    console.log('Request Origin:', requestOrigin);
    console.log('RP ID:', requestRPID);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: user.webauthnRegistrationChallenge,
        expectedOrigin: requestOrigin,
        expectedRPID: requestRPID,
        requireUserVerification: true
      });
      console.log('Verification result:', verification);
    } catch (error) {
      console.error('Verification error:', error);
      console.error('Error stack:', error.stack);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        code: error.code
      });
      return res.status(400).json({
        success: false,
        message: 'Fingerprint verification failed: ' + error.message,
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }

    const { verified, registrationInfo } = verification;

    console.log('Verification completed:', {
      verified,
      hasRegistrationInfo: !!registrationInfo,
      registrationInfoKeys: registrationInfo ? Object.keys(registrationInfo) : [],
      registrationInfoFull: JSON.stringify(registrationInfo, (key, value) => {
        if (value instanceof Buffer) {
          return `<Buffer: ${value.length} bytes>`;
        }
        return value;
      }, 2).substring(0, 2000)
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Fingerprint verification failed'
      });
    }

    if (!registrationInfo) {
      console.error('Verification succeeded but registrationInfo is missing');
      return res.status(400).json({
        success: false,
        message: 'Invalid registration response: missing registration information'
      });
    }

    // In SimpleWebAuthn v13+, credential info is nested in registrationInfo.credential
    const credentialInfo = registrationInfo.credential || registrationInfo;

    // Check both old and new structure
    let credentialID = credentialInfo.id || credentialInfo.credentialID || registrationInfo.credentialID;
    let credentialPublicKey = credentialInfo.publicKey || credentialInfo.credentialPublicKey || registrationInfo.credentialPublicKey;
    const counter = credentialInfo.counter || registrationInfo.counter || 0;

    console.log('Credential info extracted:', {
      credentialIDType: typeof credentialID,
      credentialIDValue: credentialID,
      credentialPublicKeyType: typeof credentialPublicKey,
      isPublicKeyBuffer: Buffer.isBuffer(credentialPublicKey),
      isPublicKeyUint8Array: credentialPublicKey instanceof Uint8Array,
      hasCredentialInfo: !!credentialInfo,
      credentialInfoKeys: credentialInfo ? Object.keys(credentialInfo) : []
    });

    // Validate credential structure
    if (!credentialID) {
      console.error('Missing credentialID in registrationInfo');
      console.error('Available keys:', Object.keys(registrationInfo));
      console.error('CredentialInfo keys:', credentialInfo ? Object.keys(credentialInfo) : 'null');
      return res.status(400).json({
        success: false,
        message: 'Invalid registration response: missing credential ID'
      });
    }

    if (!credentialPublicKey) {
      console.error('Missing credentialPublicKey in registrationInfo');
      console.error('Available keys:', Object.keys(registrationInfo));
      console.error('CredentialInfo keys:', credentialInfo ? Object.keys(credentialInfo) : 'null');
      return res.status(400).json({
        success: false,
        message: 'Invalid registration response: missing public key'
      });
    }

    // Handle credential ID - it might already be a base64url string (v13+) or a Buffer (older versions)
    let credentialIdBase64URL;
    if (typeof credentialID === 'string') {
      // Already a base64url string, use it directly
      credentialIdBase64URL = credentialID;
    } else if (Buffer.isBuffer(credentialID)) {
      // Convert Buffer to base64url string
      credentialIdBase64URL = isoBase64URL.fromBuffer(credentialID);
    } else {
      console.error('Invalid credentialID type:', typeof credentialID);
      return res.status(400).json({
        success: false,
        message: 'Invalid credential ID format'
      });
    }

    // Handle public key - it might be a Uint8Array (v13+) or a Buffer (older versions)
    let publicKeyBase64URL;
    if (typeof credentialPublicKey === 'string') {
      // Already a base64url string, use it directly
      publicKeyBase64URL = credentialPublicKey;
    } else if (credentialPublicKey instanceof Uint8Array) {
      // Convert Uint8Array to Buffer, then to base64url string
      const buffer = Buffer.from(credentialPublicKey);
      publicKeyBase64URL = isoBase64URL.fromBuffer(buffer);
    } else if (Buffer.isBuffer(credentialPublicKey)) {
      // Convert Buffer to base64url string
      publicKeyBase64URL = isoBase64URL.fromBuffer(credentialPublicKey);
    } else {
      console.error('Invalid credentialPublicKey type:', typeof credentialPublicKey);
      return res.status(400).json({
        success: false,
        message: 'Invalid public key format'
      });
    }

    console.log('Saving credential:', {
      credentialIdLength: credentialIdBase64URL.length,
      publicKeyLength: publicKeyBase64URL.length,
      hasCredentialId: !!credentialIdBase64URL,
      hasPublicKey: !!publicKeyBase64URL,
      counter: counter
    });

    // Validate that we have the required fields (check for existence and non-empty strings)
    if (!credentialIdBase64URL || credentialIdBase64URL.trim().length === 0) {
      console.error('Missing or empty credentialId:', {
        credentialId: credentialIdBase64URL,
        length: credentialIdBase64URL?.length
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid credential data: missing credential ID'
      });
    }

    if (!publicKeyBase64URL || publicKeyBase64URL.trim().length === 0) {
      console.error('Missing or empty publicKey:', {
        publicKey: publicKeyBase64URL,
        length: publicKeyBase64URL?.length,
        registrationInfo: {
          hasCredentialPublicKey: !!registrationInfo.credentialPublicKey,
          credentialPublicKeyType: typeof registrationInfo.credentialPublicKey,
          credentialPublicKeyIsBuffer: Buffer.isBuffer(registrationInfo.credentialPublicKey)
        }
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid credential data: missing public key'
      });
    }

    // Save the credential - ensure all required fields are present
    const newCredential = {
      credentialId: credentialIdBase64URL,
      publicKey: publicKeyBase64URL,
      counter: counter || 0,
      deviceName: deviceName || 'Fingerprint',
      registeredAt: new Date()
    };

    console.log('[REGISTER] New credential object:', {
      hasCredentialId: !!newCredential.credentialId,
      credentialIdLength: newCredential.credentialId?.length || 0,
      credentialIdPreview: newCredential.credentialId?.substring(0, 30) || 'null',
      hasPublicKey: !!newCredential.publicKey,
      publicKeyLength: newCredential.publicKey?.length || 0,
      counter: newCredential.counter,
      deviceName: newCredential.deviceName
    });

    console.log('[REGISTER] User before push - credentials count:', user.webauthnCredentials?.length || 0);
    user.webauthnCredentials.push(newCredential);
    console.log('[REGISTER] User after push - credentials count:', user.webauthnCredentials?.length || 0);
    console.log('[REGISTER] User credentials array:', JSON.stringify(user.webauthnCredentials.map(c => ({
      id: c.credentialId?.substring(0, 30),
      deviceName: c.deviceName
    }))));

    // Clear the challenge
    user.webauthnRegistrationChallenge = undefined;

    try {
      console.log('[REGISTER] Attempting to save user...');
      const savedUser = await user.save();
      console.log('[REGISTER] User saved successfully');
      console.log('[REGISTER] Saved user credentials count:', savedUser.webauthnCredentials?.length || 0);

      // Verify by fetching the user again
      const verifyUser = await User.findById(user._id).select('+webauthnCredentials');
      console.log('[REGISTER] Verification - fetched user credentials count:', verifyUser.webauthnCredentials?.length || 0);
      if (verifyUser.webauthnCredentials && verifyUser.webauthnCredentials.length > 0) {
        verifyUser.webauthnCredentials.forEach((cred, idx) => {
          console.log(`[REGISTER]   Saved cred ${idx}: id=${cred.credentialId?.substring(0, 30)}..., device=${cred.deviceName}`);
        });
      }
    } catch (saveError) {
      console.error('[REGISTER] Error saving credential:', saveError);
      console.error('[REGISTER] Save error details:', {
        message: saveError.message,
        errors: saveError.errors,
        stack: saveError.stack
      });
      return res.status(500).json({
        success: false,
        message: 'Error saving credential: ' + saveError.message,
        details: process.env.NODE_ENV === 'development' ? saveError.errors : undefined
      });
    }

    res.json({
      success: true,
      message: 'Fingerprint registered successfully',
      data: {
        credentialId: credentialIdBase64URL
      }
    });
  } catch (error) {
    console.error('WebAuthn registration complete error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing fingerprint registration',
      error: error.message
    });
  }
});

// @route   POST /api/auth/webauthn/login/start
// @desc    Start WebAuthn authentication (usernameless - no email required)
// @access  Public
router.post('/webauthn/login/start', async (req, res) => {
  try {
    // For usernameless authentication, we don't need email
    // The browser will find the credential using resident keys

    // Get RP ID from request
    const requestRPID = getRPID(req);

    const options = await generateAuthenticationOptions({
      rpID: requestRPID,
      timeout: 60000,
      // Don't specify allowCredentials - this enables usernameless authentication
      // The browser will find the resident key automatically
      userVerification: 'preferred'
    });

    // Store challenge temporarily for verification (will be matched to user after auth)
    challengeStore.set(options.challenge, {
      timestamp: Date.now()
    });

    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('WebAuthn login start error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error starting fingerprint login',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// @route   POST /api/auth/webauthn/login/complete
// @desc    Complete WebAuthn authentication
// @access  Public
console.log('[AUTH ROUTES] Registering route: POST /webauthn/login/complete');

// Test route to verify router works
router.post('/webauthn/test', async (req, res) => {
  console.log('[TEST ROUTE] Test route hit!');
  res.json({ success: true, message: 'Test route works' });
});

router.post('/webauthn/login/complete', async (req, res) => {
  console.log('[AUTH ROUTES] ========== Route /webauthn/login/complete HIT! ==========');
  console.log('[AUTH ROUTES] Request body:', JSON.stringify(req.body).substring(0, 200));
  try {
    const { credential } = req.body;
    console.log('[AUTH ROUTES] Step 1: Extracted credential, id:', credential?.id);

    if (!credential || !credential.id) {
      console.log('[AUTH ROUTES] Step 1.1: Missing credential or id');
      return res.status(400).json({
        success: false,
        message: 'Credential is required'
      });
    }

    console.log('[AUTH ROUTES] Step 2: Searching for users with credential ID:', credential.id);
    console.log('[AUTH ROUTES] Step 2.0: Credential ID type:', typeof credential.id, 'length:', credential.id?.length);

    // Check if ANY users have credentials at all
    const allUsersWithCredentials = await User.find({
      'webauthnCredentials.0': { $exists: true }
    }).select('+webauthnCredentials email role employee verificationStatus isActive').limit(10);
    console.log('[AUTH ROUTES] Step 2.0.0: Total users with any credentials:', allUsersWithCredentials?.length || 0);
    if (allUsersWithCredentials && allUsersWithCredentials.length > 0) {
      allUsersWithCredentials.forEach((u, idx) => {
        console.log(`[AUTH ROUTES] User ${idx}: email=${u.email}, verified=${u.verificationStatus}, active=${u.isActive}, creds=${u.webauthnCredentials?.length || 0}`);
        if (u.webauthnCredentials && u.webauthnCredentials.length > 0) {
          u.webauthnCredentials.forEach((cred, cidx) => {
            const credIdPreview = cred.credentialId ? cred.credentialId.substring(0, 30) : 'null';
            const isMatch = cred.credentialId === credential.id;
            console.log(`[AUTH ROUTES]   Cred ${cidx}: id=${credIdPreview}..., storedLength=${cred.credentialId?.length || 0}, searchLength=${credential.id?.length || 0}, match=${isMatch}`);
            if (!isMatch && cred.credentialId && credential.id) {
              // Check if they're similar (maybe encoding issue)
              console.log(`[AUTH ROUTES]     Stored first 10: ${cred.credentialId.substring(0, 10)}, Search first 10: ${credential.id.substring(0, 10)}`);
            }
          });
        }
      });
    }

    // First, try without the verification status filter to see if there are any users with this credential
    const allUsersAnyStatus = await User.find({
      'webauthnCredentials.credentialId': credential.id
    }).select('+webauthnCredentials email role employee verificationStatus isActive');
    console.log('[AUTH ROUTES] Step 2.0.1: Found users (any status) with matching credential ID:', allUsersAnyStatus?.length || 0);

    // For usernameless authentication, find user by credential ID
    // Search all users for this credential ID
    // Note: webauthnCredentials might not be selected by default, so we need to explicitly include it
    const allUsers = await User.find({
      'webauthnCredentials.credentialId': credential.id,
      verificationStatus: 'approved',
      isActive: true
    })
      .select('+webauthnCredentials email role employee')
      .populate({
        path: 'employee',
        populate: { path: 'department' }
      });
    console.log('[AUTH ROUTES] Step 2.1: Found users (approved & active):', allUsers?.length || 0);

    // Verify credentials are loaded
    if (allUsers && allUsers.length > 0) {
      allUsers.forEach((u, idx) => {
        console.log(`[AUTH ROUTES] User ${idx} (${u.email}): credentials=${u.webauthnCredentials?.length || 0}, isArray=${Array.isArray(u.webauthnCredentials)}`);
      });
    }

    if (!allUsers || allUsers.length === 0) {
      console.log('[AUTH ROUTES] Step 2.2: No users found with credential');
      return res.status(404).json({
        success: false,
        message: 'Fingerprint credential not found or account not active'
      });
    }

    console.log('[AUTH ROUTES] Step 3: Finding matching credential in users');
    console.log('[AUTH ROUTES] Step 3.0: All users array length:', allUsers?.length || 0);

    // Find the user with matching credential
    let user = null;
    let userCredential = null;

    for (const u of allUsers) {
      console.log(`[AUTH ROUTES] Step 3.1: Checking user ${u.email}, hasCredentials: ${!!u.webauthnCredentials}, credentialsType: ${typeof u.webauthnCredentials}, isArray: ${Array.isArray(u.webauthnCredentials)}, length: ${u.webauthnCredentials?.length || 0}`);

      // If credentials aren't loaded, fetch them explicitly
      if (!u.webauthnCredentials || !Array.isArray(u.webauthnCredentials)) {
        console.log(`[AUTH ROUTES] Step 3.2: User ${u.email} credentials not loaded, fetching...`);
        const userWithCreds = await User.findById(u._id)
          .select('+webauthnCredentials')
          .populate({
            path: 'employee',
            populate: { path: 'department' }
          });
        if (userWithCreds && userWithCreds.webauthnCredentials && Array.isArray(userWithCreds.webauthnCredentials)) {
          u.webauthnCredentials = userWithCreds.webauthnCredentials;
          u.employee = userWithCreds.employee; // Preserve populated employee
          console.log(`[AUTH ROUTES] Step 3.2.1: Fetched ${u.webauthnCredentials.length} credentials for user ${u.email}`);
        } else {
          console.log(`[AUTH ROUTES] Step 3.2.2: Still no credentials after fetch, skipping`);
          continue;
        }
      }

      const cred = u.webauthnCredentials.find(
        c => c && c.credentialId === credential.id
      );

      if (cred) {
        console.log(`[AUTH ROUTES] Step 3.3: Found matching credential for user ${u.email}`);
        user = u;
        userCredential = cred;
        break;
      } else {
        console.log(`[AUTH ROUTES] Step 3.4: No matching credential in user ${u.email}, checking all creds:`);
        u.webauthnCredentials.forEach((c, idx) => {
          const match = c && c.credentialId === credential.id;
          console.log(`[AUTH ROUTES]   Cred ${idx}: id=${c?.credentialId?.substring(0, 30)}..., match=${match}`);
        });
      }
    }

    if (!user || !userCredential) {
      console.log('[AUTH ROUTES] Step 3.5: User or credential not found after search');
      return res.status(404).json({
        success: false,
        message: 'Fingerprint credential not found'
      });
    }

    console.log('[AUTH ROUTES] Step 3.6: Found user and credential:', user.email, userCredential.credentialId?.substring(0, 30));

    console.log('[AUTH ROUTES] Step 4: User found, converting credentials to buffers');
    console.log('[AUTH ROUTES] Step 4.0: UserCredential object:', {
      hasCredentialId: !!userCredential.credentialId,
      hasPublicKey: !!userCredential.publicKey,
      counter: userCredential.counter,
      counterType: typeof userCredential.counter,
      deviceName: userCredential.deviceName
    });

    // Convert stored base64url back to buffers/Uint8Arrays for verification
    // SimpleWebAuthn v13 expects:
    // - credentialID: Buffer or Uint8Array
    // - credentialPublicKey: Uint8Array (COSE key format)
    let credentialID = isoBase64URL.toBuffer(userCredential.credentialId);

    // Ensure credentialID is a proper Buffer
    credentialID = Buffer.isBuffer(credentialID) ? credentialID : Buffer.from(credentialID);

    // Convert public key from base64url string to Buffer, then to Uint8Array
    // The public key is stored as base64url string representing COSE key bytes
    const publicKeyBuffer = isoBase64URL.toBuffer(userCredential.publicKey);
    const credentialPublicKey = new Uint8Array(publicKeyBuffer);

    // Ensure counter has a default value if undefined and is a valid number
    let credentialCounter = 0;
    if (userCredential.counter !== undefined && userCredential.counter !== null) {
      credentialCounter = typeof userCredential.counter === 'number' ? userCredential.counter : parseInt(userCredential.counter, 10) || 0;
    }

    console.log('[AUTH ROUTES] Step 4.1: Converted to buffers - credentialID type:', credentialID.constructor.name, 'length:', credentialID.length, 'publicKey type:', credentialPublicKey.constructor.name, 'length:', credentialPublicKey.length, 'counter:', credentialCounter, 'counterType:', typeof credentialCounter);

    // Get request origin and RP ID for verification
    const requestOrigin = getOrigin(req);
    const requestRPID = getRPID(req);

    console.log('[AUTH ROUTES] Step 5: Extracting challenge from credential response');
    // Extract challenge from the credential response for verification
    // The challenge should be in the clientDataJSON
    let expectedChallenge;
    try {
      const clientDataJSON = Buffer.from(credential.response.clientDataJSON, 'base64url');
      const clientData = JSON.parse(clientDataJSON.toString());
      expectedChallenge = clientData.challenge;
      console.log('[AUTH ROUTES] Step 5.1: Extracted challenge:', expectedChallenge);

      // Verify the challenge was issued by us
      if (!challengeStore.has(expectedChallenge)) {
        console.log('[AUTH ROUTES] Step 5.2: Challenge not found in store');
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired authentication challenge'
        });
      }

      console.log('[AUTH ROUTES] Step 5.3: Challenge verified, removing from store');
      // Remove used challenge
      challengeStore.delete(expectedChallenge);
    } catch (error) {
      console.error('[AUTH ROUTES] Step 5.ERROR: Error extracting challenge:', error);
      return res.status(400).json({
        success: false,
        message: 'Invalid credential response'
      });
    }

    console.log('[AUTH ROUTES] Step 6: Verifying authentication response');
    let verification;
    try {
      // Ensure all required fields are present and valid
      if (!credentialID || !credentialPublicKey) {
        console.error('[AUTH ROUTES] Step 6.ERROR: Missing credential ID or public key');
        return res.status(400).json({
          success: false,
          message: 'Invalid credential data'
        });
      }

      // SimpleWebAuthn v13 expects the credential object with specific property names
      // From the library source: verifyAuthenticationResponse extracts credential.id and credential.publicKey
      // It uses credential.id for the credentialID and credential.publicKey which it passes to verifySignature
      const authenticatorObj = {
        id: credentialID,  // Library extracts this as credentialID internally
        publicKey: credentialPublicKey,  // Library extracts this and passes as credentialPublicKey to verifySignature
        counter: credentialCounter || 0
      };

      console.log('[AUTH ROUTES] Step 6.0: Credential object:', {
        hasId: !!authenticatorObj.id,
        idType: authenticatorObj.id?.constructor?.name,
        idLength: authenticatorObj.id?.length,
        hasPublicKey: !!authenticatorObj.publicKey,
        publicKeyType: authenticatorObj.publicKey?.constructor?.name,
        publicKeyLength: authenticatorObj.publicKey?.length,
        counter: authenticatorObj.counter,
        counterType: typeof authenticatorObj.counter
      });

      console.log('[AUTH ROUTES] Step 6.1: Calling verifyAuthenticationResponse with:', {
        hasResponse: !!credential,
        hasExpectedChallenge: !!expectedChallenge,
        expectedOrigin: requestOrigin,
        expectedRPID: requestRPID,
        hasAuthenticator: !!authenticatorObj,
        authenticatorKeys: Object.keys(authenticatorObj)
      });

      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: expectedChallenge,
        expectedOrigin: requestOrigin,
        expectedRPID: requestRPID,
        credential: authenticatorObj,  // Fixed: parameter name should be 'credential', not 'authenticator'
        requireUserVerification: true
      });
      console.log('[AUTH ROUTES] Step 6.1: Verification completed, verified:', verification.verified);
    } catch (error) {
      console.error('[AUTH ROUTES] Step 6.ERROR: Authentication verification error:', error);
      console.error('[AUTH ROUTES] Error stack:', error.stack);
      return res.status(400).json({
        success: false,
        message: 'Fingerprint authentication failed: ' + error.message
      });
    }

    const { verified, authenticationInfo } = verification;
    console.log('[AUTH ROUTES] Step 7: Verification result - verified:', verified, 'hasInfo:', !!authenticationInfo);

    if (verified && authenticationInfo) {
      console.log('[AUTH ROUTES] Step 8: Authentication successful, updating user and generating token');
      // Update credential counter
      userCredential.counter = authenticationInfo.newCounter;
      userCredential.lastUsed = new Date();

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate JWT token
      const token = generateToken(user._id);

      // Ensure employee is populated (it should already be from the query, but double-check)
      if (user.employee && typeof user.employee === 'object' && user.employee.firstName) {
        // Employee is already populated
      } else if (user.employee) {
        // Employee is an ObjectId, need to populate
        await user.populate({
          path: 'employee',
          populate: { path: 'department' }
        });
      }

      console.log('[AUTH ROUTES] Step 9: Sending success response');
      res.json({
        success: true,
        message: 'Fingerprint login successful',
        data: {
          token,
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            employee: user.employee ? {
              id: user.employee._id,
              employeeId: user.employee.employeeId,
              firstName: user.employee.firstName,
              lastName: user.employee.lastName,
              fullName: user.employee.fullName,
              avatar: user.employee.avatar,
              department: user.employee.department,
              designation: user.employee.designation
            } : null
          }
        }
      });
      console.log('[AUTH ROUTES] Step 10: Response sent successfully');
    } else {
      console.log('[AUTH ROUTES] Step 8.1: Verification failed');
      res.status(400).json({
        success: false,
        message: 'Fingerprint authentication failed'
      });
    }
  } catch (error) {
    console.error('[AUTH ROUTES] FATAL ERROR in login/complete:', error);
    console.error('[AUTH ROUTES] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error completing fingerprint login',
      error: error.message
    });
  }
});

// @route   DELETE /api/auth/webauthn/credential/:credentialId
// @desc    Delete a fingerprint credential
// @access  Private
router.delete('/webauthn/credential/:credentialId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find credential (stored as base64url)
    const credentialIndex = user.webauthnCredentials.findIndex(
      cred => cred.credentialId === req.params.credentialId
    );

    if (credentialIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Credential not found'
      });
    }

    user.webauthnCredentials.splice(credentialIndex, 1);
    await user.save();

    res.json({
      success: true,
      message: 'Fingerprint removed successfully'
    });
  } catch (error) {
    console.error('Delete credential error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing fingerprint',
      error: error.message
    });
  }
});

// @route   GET /api/auth/webauthn/credentials
// @desc    Get user's fingerprint credentials
// @access  Private
router.get('/webauthn/credentials', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('webauthnCredentials');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const credentials = user.webauthnCredentials.map(cred => ({
      credentialId: cred.credentialId,
      deviceName: cred.deviceName || 'Fingerprint',
      registeredAt: cred.registeredAt,
      lastUsed: cred.lastUsed
    }));

    res.json({
      success: true,
      data: { credentials }
    });
  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching fingerprint credentials',
      error: error.message
    });
  }
});

module.exports = router;
