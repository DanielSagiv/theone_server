# Email Verification on Signup - Implementation Specification

## Overview
This document details the complete implementation of email verification for user signup in The1 Platform. Users must verify their email address before they can access the platform.

---

## User Flow

### Registration Flow

```
1. User fills out signup form
   ↓
2. Backend creates user account (emailVerified: false)
   ↓
3. Verification email sent to user
   ↓
4. User receives email with verification link
   ↓
5. User clicks verification link
   ↓
6. Backend validates token and marks email as verified
   ↓
7. User can now login
```

### Login Flow with Verification

```
1. User attempts to login
   ↓
2. Backend checks credentials
   ↓
3. Backend checks if emailVerified === true
   ↓
4. If not verified: Show error with resend option
   ↓
5. If verified: Allow login and create session
```

---

## Database Schema Changes

### User Model Updates

**File**: `models/User.js`

**New Fields**:
```javascript
{
  // Email Verification Fields
  emailVerified: {
    type: Boolean,
    default: false,
    index: true  // For querying unverified users
  },
  
  emailVerificationToken: {
    type: String,
    index: true  // For quick token lookup
  },
  
  emailVerificationExpires: {
    type: Date,
    index: true  // For cleanup of expired tokens
  },
  
  emailVerificationSentAt: {
    type: Date
  },
  
  // Optional: Track verification completion
  emailVerifiedAt: {
    type: Date
  }
}
```

**Index Strategy**:
- `emailVerified`: For filtering verified/unverified users
- `emailVerificationToken`: For token validation lookups
- `emailVerificationExpires`: For cleanup queries

---

## Backend Implementation

### Phase 1: Update User Registration

**File**: `services/authService.js`

**Function**: `registerUser(userData)`

**Changes**:
```javascript
const crypto = require('crypto');
const emailService = require('../utils/emailService');

const registerUser = async (userData) => {
  try {
    // 1. Check if user already exists
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      // If user exists but email not verified, allow resend
      if (!existingUser.emailVerified) {
        throw new Error('EMAIL_NOT_VERIFIED');
      }
      throw new Error('User with this email already exists');
    }

    // 2. Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // 3. Create user with verification fields
    const user = new User({
      ...userData,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
      emailVerificationSentAt: new Date(),
      entity_status: 'pendingApproval'  // or 'live' if no admin approval needed
    });
    
    await user.save();

    // 4. Send verification email (async, non-blocking)
    emailService.sendVerificationEmail(user, verificationToken)
      .then(() => {
        console.log('Verification email sent:', { 
          email: user.email, 
          timestamp: new Date().toISOString() 
        });
      })
      .catch(err => {
        console.error('Email send error:', { 
          email: user.email, 
          error: err.message,
          timestamp: new Date().toISOString()
        });
        // Don't throw - user can resend later
      });

    // 5. Return success (don't expose sensitive data)
    return {
      user: user.getProfile(),
      message: 'Account created successfully. Please check your email to verify your account.'
    };

  } catch (error) {
    console.error('User registration error:', error);
    throw error;
  }
};
```

---

### Phase 2: Email Verification Endpoint

**File**: `routes/auth.js`

**Endpoint**: `POST /v1/auth/verify-email`

**Implementation**:
```javascript
const Joi = require('joi');

// Validation schema
const verifyEmailSchema = Joi.object({
  token: Joi.string().length(64).required()  // 32 bytes = 64 hex chars
});

/**
 * POST /v1/auth/verify-email
 * Verify user email with token
 */
router.post('/verify-email', async (req, res) => {
  try {
    // 1. Validate input
    const { error, value } = verifyEmailSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { token } = value;

    // 2. Find user with valid token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired verification token'
        }
      });
    }

    // 3. Check if already verified
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email is already verified'
        }
      });
    }

    // 4. Mark email as verified
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;  // Clear token
    user.emailVerificationExpires = undefined;  // Clear expiry
    
    // 5. Optionally auto-approve user
    if (user.entity_status === 'pendingApproval') {
      user.entity_status = 'live';  // Auto-approve after email verification
    }
    
    await user.save();

    // 6. Send welcome email (optional)
    emailService.sendWelcomeEmail(user)
      .catch(err => console.error('Welcome email error:', err));

    // 7. Log verification event
    console.log('Email verified:', {
      userId: user._id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    // 8. Return success
    res.json({
      success: true,
      data: {
        message: 'Email verified successfully! You can now log in.',
        redirectUrl: '/test/login'
      }
    });

  } catch (error) {
    console.error('Email verification error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: 'Email verification failed'
      }
    });
  }
});
```

---

### Phase 3: Resend Verification Email

**File**: `routes/auth.js`

**Endpoint**: `POST /v1/auth/resend-verification`

**Implementation**:
```javascript
const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required()
});

/**
 * POST /v1/auth/resend-verification
 * Resend verification email to user
 */
router.post('/resend-verification', async (req, res) => {
  try {
    // 1. Validate input
    const { error, value } = resendVerificationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { email } = value;

    // 2. Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Don't reveal if user exists (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a verification link has been sent.'
      });
    }

    // 3. Check if already verified
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email is already verified'
        }
      });
    }

    // 4. Check rate limiting (prevent spam)
    const lastSent = user.emailVerificationSentAt;
    if (lastSent) {
      const minutesSinceLastSend = (Date.now() - lastSent) / 1000 / 60;
      if (minutesSinceLastSend < 5) {  // 5 minutes cooldown
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Please wait ${Math.ceil(5 - minutesSinceLastSend)} minutes before requesting another verification email`
          }
        });
      }
    }

    // 5. Generate new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.emailVerificationSentAt = new Date();
    await user.save();

    // 6. Send email
    await emailService.sendVerificationEmail(user, verificationToken);

    // 7. Log resend event
    console.log('Verification email resent:', {
      userId: user._id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    // 8. Return success
    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    });

  } catch (error) {
    console.error('Resend verification error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'RESEND_FAILED',
        message: 'Failed to resend verification email'
      }
    });
  }
});
```

---

### Phase 4: Update Login Flow

**File**: `services/authService.js`

**Function**: `authenticateUser(email, password, req)`

**Add Email Verification Check**:
```javascript
const authenticateUser = async (email, password, req) => {
  try {
    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }

    // NEW: Check if email is verified
    if (!user.emailVerified) {
      throw new Error('EMAIL_NOT_VERIFIED');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error('User account is disabled');
    }

    // Check entity status
    if (user.entity_status === 'deleted') {
      throw new Error('Your account has been deleted. Please contact an administrator.');
    }

    if (user.entity_status === 'pendingApproval') {
      throw new Error('Your account is pending approval. Please contact an administrator.');
    }

    if (user.entity_status === 'suspended') {
      throw new Error('Your account has been suspended. Please contact an administrator.');
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token and create session
    const token = generateToken(user._id, user.email, user.role);
    await createSession(user._id, token, req);

    return {
      token,
      user: user.getProfile()
    };

  } catch (error) {
    console.error('User authentication error:', error);
    throw error;
  }
};
```

**Update Login Route Error Handling**:
```javascript
// In routes/auth.js - POST /v1/auth/signin
catch (error) {
  console.error('Signin error:', {
    error: error.message,
    timestamp: new Date().toISOString()
  });

  // Special handling for unverified email
  if (error.message === 'EMAIL_NOT_VERIFIED') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        action: 'resend_verification'  // Frontend can show resend button
      }
    });
  }

  // Other error handling...
}
```

---

## Frontend Implementation

### Phase 1: Update Signup Page

**File**: `views/test/signup.ejs`

**After Successful Registration**:
```javascript
async function handleSignup(e) {
  e.preventDefault();
  
  try {
    const formData = {
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
      firstName: document.getElementById('firstName').value,
      lastName: document.getElementById('lastName').value,
      phone: document.getElementById('phone').value,
      // ... other fields
    };

    const response = await fetch('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (result.success) {
      // Show success message with email verification notice
      showSuccessMessage(`
        <h3>Account Created Successfully!</h3>
        <p>We've sent a verification email to <strong>${formData.email}</strong></p>
        <p>Please check your inbox and click the verification link to activate your account.</p>
        <p>Can't find the email? Check your spam folder.</p>
        <button onclick="resendVerification('${formData.email}')">Resend Verification Email</button>
        <br><br>
        <a href="/test/login">Go to Login</a>
      `);
      
      // Clear form
      document.getElementById('signupForm').reset();
    } else {
      showErrorMessage(result.error.message);
    }

  } catch (error) {
    showErrorMessage('Signup failed. Please try again.');
  }
}

async function resendVerification(email) {
  try {
    const response = await fetch('/v1/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const result = await response.json();
    
    if (result.success) {
      showSuccessMessage('Verification email sent! Please check your inbox.');
    } else {
      showErrorMessage(result.error.message);
    }
  } catch (error) {
    showErrorMessage('Failed to resend email. Please try again later.');
  }
}
```

---

### Phase 2: Create Email Verification Page

**File**: `views/test/verify-email.ejs`

**Purpose**: Handle verification link clicks

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Email - The1 Platform</title>
    <style>
        /* Similar styling to login/signup pages */
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .verify-container {
            background: white;
            border-radius: 20px;
            padding: 50px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        .loading {
            color: #667eea;
            font-size: 1.2rem;
        }
        .success {
            color: #27ae60;
        }
        .error {
            color: #e74c3c;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            text-decoration: none;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="verify-container">
        <h1>Email Verification</h1>
        <div id="status">
            <p class="loading">Verifying your email...</p>
        </div>
    </div>

    <script>
        async function verifyEmail() {
            // Get token from URL
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');

            if (!token) {
                showError('Invalid verification link');
                return;
            }

            try {
                const response = await fetch('/v1/auth/verify-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });

                const result = await response.json();

                if (result.success) {
                    showSuccess();
                } else {
                    showError(result.error.message);
                }

            } catch (error) {
                showError('Verification failed. Please try again.');
            }
        }

        function showSuccess() {
            document.getElementById('status').innerHTML = `
                <div class="success">
                    <h2>✓ Email Verified!</h2>
                    <p>Your email has been successfully verified.</p>
                    <p>You can now log in to your account.</p>
                    <a href="/test/login" class="btn">Go to Login</a>
                </div>
            `;
        }

        function showError(message) {
            document.getElementById('status').innerHTML = `
                <div class="error">
                    <h2>Verification Failed</h2>
                    <p>${message}</p>
                    <p>The link may have expired or is invalid.</p>
                    <a href="/test/login" class="btn">Go to Login</a>
                </div>
            `;
        }

        // Auto-verify on page load
        verifyEmail();
    </script>
</body>
</html>
```

**Add Route**:
```javascript
// In routes/test.js
router.get('/verify-email', (req, res) => {
  res.render('test/verify-email', {
    title: 'Verify Email - The1 Platform'
  });
});
```

---

### Phase 3: Update Login Page

**File**: `views/test/login.ejs`

**Handle Email Not Verified Error**:
```javascript
async function handleLogin(e) {
  e.preventDefault();
  
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/v1/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json();

    if (result.success) {
      // Store token and redirect
      localStorage.setItem('token', result.data.token);
      window.location.href = '/test/dashboard';
    } else {
      // Check for email not verified error
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        showEmailNotVerifiedError(email);
      } else {
        showErrorMessage(result.error.message);
      }
    }

  } catch (error) {
    showErrorMessage('Login failed. Please try again.');
  }
}

function showEmailNotVerifiedError(email) {
  const errorHtml = `
    <div class="error-message">
      <h4>Email Not Verified</h4>
      <p>Please verify your email address before logging in.</p>
      <p>Check your inbox for the verification link.</p>
      <button onclick="resendVerification('${email}')">Resend Verification Email</button>
    </div>
  `;
  document.getElementById('errorContainer').innerHTML = errorHtml;
}

async function resendVerification(email) {
  try {
    const response = await fetch('/v1/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const result = await response.json();
    
    if (result.success) {
      showSuccessMessage('Verification email sent! Please check your inbox.');
    } else {
      showErrorMessage(result.error.message);
    }
  } catch (error) {
    showErrorMessage('Failed to resend email.');
  }
}
```

---

## Validation Schemas

**File**: `utils/validationSchemas.js`

**Add Verification Schemas**:
```javascript
const verifyEmailSchema = Joi.object({
  token: Joi.string()
    .length(64)
    .hex()
    .required()
    .messages({
      'string.length': 'Invalid verification token',
      'string.hex': 'Invalid verification token format'
    })
});

const resendVerificationSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address'
    })
});

module.exports = {
  // ... existing schemas
  verifyEmailSchema,
  resendVerificationSchema
};
```

---

## Security Considerations

### Token Security

1. **Token Generation**
   - Use `crypto.randomBytes(32)` for cryptographically secure tokens
   - Convert to hex string (64 characters)
   - Never use predictable values (timestamps, user IDs)

2. **Token Expiration**
   - Set 24-hour expiration for verification tokens
   - Clean up expired tokens regularly
   - Allow users to request new tokens

3. **Rate Limiting**
   - Limit verification email resends to once per 5 minutes
   - Track attempts in database or cache
   - Prevent abuse and spam

### Data Protection

1. **User Privacy**
   - Don't reveal if email exists in resend endpoint
   - Use generic success messages
   - Log all verification attempts

2. **Token Storage**
   - Store tokens securely in database
   - Never expose tokens in logs
   - Clear tokens after verification

---

## Database Maintenance

### Cleanup Tasks

**Delete Expired Unverified Users** (Optional):
```javascript
// Run daily via cron job
async function cleanupUnverifiedUsers() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const result = await User.deleteMany({
    emailVerified: false,
    createdAt: { $lt: thirtyDaysAgo }
  });
  
  console.log(`Cleaned up ${result.deletedCount} unverified users`);
}
```

**Clear Expired Tokens**:
```javascript
// Run daily via cron job
async function clearExpiredTokens() {
  const result = await User.updateMany(
    { emailVerificationExpires: { $lt: Date.now() } },
    { 
      $unset: { 
        emailVerificationToken: '',
        emailVerificationExpires: ''
      }
    }
  );
  
  console.log(`Cleared ${result.modifiedCount} expired tokens`);
}
```

---

## Testing Checklist

### Manual Testing

- [ ] User signs up successfully
- [ ] Verification email is received
- [ ] Verification link works correctly
- [ ] User can login after verification
- [ ] User cannot login before verification
- [ ] Resend verification works
- [ ] Rate limiting prevents spam
- [ ] Expired tokens are rejected
- [ ] Already verified users get proper message
- [ ] Email not found returns generic message

### Edge Cases

- [ ] User tries to register with already verified email
- [ ] User clicks verification link twice
- [ ] User requests multiple verification emails
- [ ] Verification link expires
- [ ] Invalid token format
- [ ] User deletes account before verifying
- [ ] Email service is down during signup

---

## Monitoring & Analytics

### Key Metrics

1. **Verification Rate**: % of users who verify email within 24 hours
2. **Resend Rate**: % of users who request resend
3. **Verification Time**: Average time from signup to verification
4. **Abandonment Rate**: % of users who never verify

### Logging

Log these events:
- Email verification sent
- Email verification completed
- Verification email resent
- Failed verification attempts
- Expired token usage

---

## Rollout Plan

### Phase 1: Preparation
- [ ] Update User schema
- [ ] Set up AWS SES
- [ ] Implement email service
- [ ] Test email delivery

### Phase 2: Backend
- [ ] Update signup flow
- [ ] Add verification endpoint
- [ ] Add resend endpoint
- [ ] Update login flow
- [ ] Add validation schemas

### Phase 3: Frontend
- [ ] Update signup page
- [ ] Create verification page
- [ ] Update login page
- [ ] Add error handling

### Phase 4: Testing
- [ ] Test all flows
- [ ] Test edge cases
- [ ] Load testing
- [ ] Email deliverability testing

### Phase 5: Deployment
- [ ] Deploy to staging
- [ ] Test on staging
- [ ] Deploy to production
- [ ] Monitor metrics

---

## Future Enhancements

1. **Magic Link Login**: Allow login via email link (no password)
2. **SMS Verification**: Add phone number verification option
3. **Social Auth**: Allow signup via Google/Facebook (auto-verified)
4. **Email Change Flow**: Verify new email when user changes it
5. **Verification Reminders**: Send reminder emails after 24 hours

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-08  
**Status**: Ready for Implementation  
**Priority**: High

