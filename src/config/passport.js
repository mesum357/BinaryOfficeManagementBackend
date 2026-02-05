const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User');

// Local Strategy for email/password login
passport.use('local', new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
      console.log('[Passport] Login attempt', { email: email.toLowerCase() });

      const user = await User.findOne({ email: email.toLowerCase() })
        .select('+password')
        .populate({
          path: 'employee',
          populate: { path: 'department' }
        });

      if (!user) {
        console.log('[Passport] User not found', { email: email.toLowerCase() });
        return done(null, false, { message: 'Invalid email or password' });
      }

      console.log('[Passport] User found', {
        userId: user._id,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
        isActive: user.isActive,
        hasPassword: !!user.password
      });

      const isMatch = await user.comparePassword(password);
      console.log('[Passport] Password comparison result', { isMatch });

      if (!isMatch) {
        console.log('[Passport] Password mismatch');
        return done(null, false, { message: 'Invalid email or password' });
      }

      // Check verification status
      if (user.verificationStatus === 'pending') {
        console.log('[Passport] Account pending verification');
        return done(null, false, {
          message: 'Your account is pending verification. Please wait for admin approval.',
          code: 'PENDING_VERIFICATION'
        });
      }

      if (user.verificationStatus === 'rejected') {
        console.log('[Passport] Account rejected');
        return done(null, false, {
          message: `Your account registration was rejected. ${user.rejectionReason || ''}`,
          code: 'REJECTED'
        });
      }

      if (!user.isActive) {
        console.log('[Passport] Account not active');
        return done(null, false, {
          message: 'Your account has been deactivated. Please contact HR.',
          code: 'DEACTIVATED'
        });
      }

      console.log('[Passport] Authentication successful', { userId: user._id, role: user.role });
      return done(null, user);
    } catch (error) {
      console.error('[Passport] Authentication error', error);
      return done(error);
    }
  }
));

// JWT Strategy for protected routes
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
};

passport.use('jwt', new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
  try {
    const user = await User.findById(jwtPayload.id).populate({
      path: 'employee',
      populate: { path: 'department' }
    });

    if (!user) {
      return done(null, false);
    }

    if (!user.isActive) {
      return done(null, false);
    }

    return done(null, user);
  } catch (error) {
    return done(error, false);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).populate({
      path: 'employee',
      populate: { path: 'department' }
    });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;

