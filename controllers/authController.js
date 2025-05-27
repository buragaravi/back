// Controller: Authentication 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const SibApiV3Sdk = require('sib-api-v3-sdk');

// Register a new user
exports.register = async (req, res) => {
  try {
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, name, email, password, role, labId } = req.body;

    // Check if email already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    // For lab assistants, ensure labId is provided and not already taken
    if (role === 'lab_assistant') {
      if (!labId) {
        return res.status(400).json({ msg: 'Lab ID is required for lab assistants.' });
      }

      const labAssigned = await User.findOne({ role: 'lab_assistant', labId });
      if (labAssigned) {
        return res.status(400).json({ msg: `Lab ID ${labId} is already assigned to another lab assistant.` });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      userId,
      name,
      email,
      password: hashedPassword,
      role,
      ...(role === 'lab_assistant' && { labId }) // only include labId if role is lab_assistant
    });

    await newUser.save();
    res.status(201).json({ msg: 'User registered successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};


// Login a user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    // Update last login time
    user.lastLogin = Date.now();
    await user.save();
    console.log(user.userId, user.role)
    // Create JWT payload and send token
    const payload = {
      user: {
        id: user._id,
        userId: user.userId,
        role: user.role,
        labId: user.labId
      }
    };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { userId: user.userId, role: user.role } });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Get current logged-in user// Get current logged-in user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};



// Initialize Brevo client
const apiKey = process.env.BREVO_API_KEY;
const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = apiKey;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// In-memory OTP storage
const otpStorage = new Map();

// Request password reset (step 1: send OTP via Brevo)
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'No user found with this email' });

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 min expiry

    // Store OTP in memory
    otpStorage.set(email, {
      otp,
      expiry: otpExpiry,
      verified: false
    });

    // Prepare email content using your style approach
    const emailData = {
      to: [{ email }],
      subject: 'Your Password Reset OTP',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; background-color: #2d3748; padding: 20px; border-radius: 10px; color: #e2e8f0;">
          <h1 style="color: #f687b3; text-align: center;">Password Reset Request</h1>
          <p style="color: #f687b3;">Hello ${user.name || 'User'},</p>
          <p style="color: #f687b3;">Your OTP for password reset is:</p>
          <h2 style="color: #ffffff; text-align: center; font-size: 28px; letter-spacing: 3px; margin: 20px 0;">${otp}</h2>
          <p style="color: #f687b3;">This OTP is valid for 10 minutes.</p>
          <p style="color: #f687b3;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
      sender: { 
        email: process.env.BREVO_SENDER_EMAIL || 'no-reply@yourapp.com',
        name: process.env.BREVO_SENDER_NAME || 'Pydah Pharmacy Stocks Management System'
      }
    };
    console.log(email);

    // Send email via Brevo
    await apiInstance.sendTransacEmail(emailData);
    console.log('OTP sent to:', email);
    console.log('OTP:', otp); // For debugging, remove in production

    res.json({ msg: 'OTP sent to your registered email address' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ 
      msg: 'Failed to send OTP',
      error: error.response?.body || error.message 
    });
  }
};

// Keep your existing verifyOtp and resetPassword functions
// Verify OTP (step 2: verify the OTP)
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ msg: 'Email and OTP are required' });

    const storedOtpData = otpStorage.get(email);
    if (!storedOtpData) return res.status(400).json({ msg: 'OTP expired or not found' });

    // Check if OTP matches and is not expired
    if (storedOtpData.otp !== otp) {
      return res.status(400).json({ msg: 'Invalid OTP' });
    }

    if (Date.now() > storedOtpData.expiry) {
      otpStorage.delete(email);
      return res.status(400).json({ msg: 'OTP has expired' });
    }

    // Mark OTP as verified
    otpStorage.set(email, { ...storedOtpData, verified: true });

    res.json({ msg: 'OTP verified successfully', token: 'temp_token_for_reset' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Reset password (step 3: update password after OTP verification)
exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ msg: 'Email and new password are required' });

    const storedOtpData = otpStorage.get(email);
    if (!storedOtpData || !storedOtpData.verified) {
      return res.status(400).json({ msg: 'OTP not verified or session expired' });
    }

    // Find user and update password
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Clear OTP from storage
    otpStorage.delete(email);

    res.json({ msg: 'Password updated successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};