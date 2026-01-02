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
      const user = await User.findOne({ email: email.toLowerCase() })
        .select('+password')
        .populate('employee');

      if (!user) {
        return done(null, false, { message: 'Invalid email or password' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return done(null, false, { message: 'Invalid email or password' });
      }

      // Check verification status
      if (user.verificationStatus === 'pending') {
        return done(null, false, { 
          message: 'Your account is pending verification. Please wait for admin approval.',
          code: 'PENDING_VERIFICATION'
        });
      }

      if (user.verificationStatus === 'rejected') {
        return done(null, false, { 
          message: `Your account registration was rejected. ${user.rejectionReason || ''}`,
          code: 'REJECTED'
        });
      }

      if (!user.isActive) {
        return done(null, false, { 
          message: 'Your account has been deactivated. Please contact HR.',
          code: 'DEACTIVATED'
        });
      }

      return done(null, user);
    } catch (error) {
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
    const user = await User.findById(jwtPayload.id).populate('employee');

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
    const user = await User.findById(id).populate('employee');
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;

