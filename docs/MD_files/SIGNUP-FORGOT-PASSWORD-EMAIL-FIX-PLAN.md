# Signup & Forgot Password Email Fix - Implementation Plan

## Overview
This document outlines the plan to fix email sending issues for user signup and password reset functionality. The current implementation shows users a message that verification codes were sent, but emails are not actually being delivered.

---

## Current Issues Identified

### 1. **Email Not Being Sent**
- AWS SES may be misconfigured (missing env vars, unverified sender, etc.)
- Email sending errors may be silently failing
- No diagnostic tools to verify email service status

### 2. **Verification Method Mismatch**
- **Server**: Sends email with a link containing a long token (64-char hex string)
- **Mobile App**: Expects a manual code input (6-digit numeric code)
- Current mismatch causes confusion - users receive links but app expects codes

### 3. **Forgot Password Flow**
- Same issue as signup: server sends link, mobile expects code
- Password reset flow needs alignment between server and mobile

---

## Implementation Plan

### **Phase 1: Diagnose Email Service (Server)**

#### 1.1 Check AWS SES Configuration
**Files to Review:**
- `.env` file (check for required variables)
- `utils/emailService.js` (verify AWS SDK configuration)

**Required Environment Variables:**
```bash
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-west-2  # or your preferred region
FROM_EMAIL=noreply@the1.vip  # Must be verified in AWS SES
FRONTEND_URL=http://localhost:3000  # or production URL
```

**Actions:**
- [ ] Verify all env vars are set in `.env`
- [ ] Verify `FROM_EMAIL` is verified in AWS SES console
- [ ] Check SES sending limits/quota in AWS console
- [ ] Verify AWS credentials have SES permissions

#### 1.2 Add Email Sending Diagnostics
**File**: `routes/test.js` or create `routes/email-test.js`

**New Endpoint**: `GET /test/email-test`
- Test sending a simple email
- Return detailed error information if sending fails
- Log full AWS SES response

**Implementation:**
```javascript
router.get('/email-test', async (req, res) => {
  try {
    const testEmail = req.query.email || process.env.CONTACT_EMAIL;
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        error: 'No email provided. Add ?email=your@email.com'
      });
    }

    // Test basic email send
    const result = await emailService.sendEmail({
      to: testEmail,
      subject: 'Test Email - The1 Platform',
      html: '<h1>Test Email</h1><p>If you receive this, email service is working!</p>'
    });

    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: result.messageId,
      to: testEmail
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error
      }
    });
  }
});
```

#### 1.3 Enhanced Error Logging
**File**: `utils/emailService.js`

**Updates:**
- Add detailed error logging with full AWS error details
- Log email send attempts (success and failure)
- Include timestamp, recipient, and error context

**Changes:**
```javascript
async function sendEmail({ to, subject, html, text }) {
  try {
    // ... existing code ...
    
    const result = await ses.sendEmail(params).promise();
    console.log('[EMAIL_SUCCESS]', { 
      to, 
      subject, 
      messageId: result.MessageId,
      timestamp: new Date().toISOString()
    });
    return { messageId: result.MessageId };
  } catch (error) {
    console.error('[EMAIL_ERROR]', { 
      to, 
      subject, 
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        requestId: error.requestId,
        retryable: error.retryable
      },
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}
```

---

### **Phase 2: Fix Verification Method (Server + Mobile)**

**Decision: Use 6-Digit Numeric Codes (Option A)**

**Rationale:**
- Better mobile UX (easier to type)
- No deep linking configuration needed
- Simpler implementation
- Standard practice for mobile apps

#### 2.1 Update User Model
**File**: `models/User.js`

**Changes:**
- Replace `emailVerificationToken` (64-char hex) with `emailVerificationCode` (6-digit string)
- Replace `resetPasswordToken` (64-char hex) with `resetPasswordCode` (6-digit string)
- Keep expiration fields (they work the same)

**Schema Updates:**
```javascript
// Replace:
emailVerificationToken: String
resetPasswordToken: String

// With:
emailVerificationCode: {
  type: String,
  length: 6,
  index: true
}
resetPasswordCode: {
  type: String,
  length: 6,
  index: true
}
```

#### 2.2 Update Auth Service
**File**: `services/authService.js`

**Function**: `registerUser()`

**Changes:**
```javascript
// OLD: Generate 64-char hex token
const verificationToken = crypto.randomBytes(32).toString('hex');

// NEW: Generate 6-digit numeric code
const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
const verificationExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

// Update user creation:
const user = new User({
  ...userData,
  emailVerified: false,
  emailVerificationCode: verificationCode,
  emailVerificationExpires: verificationExpires,
  emailVerificationSentAt: new Date(),
  entity_status: 'pendingApproval'
});

// Update email call:
emailService.sendVerificationEmail(user, verificationCode)
```

**Function**: `requestPasswordReset()`

**Changes:**
```javascript
// OLD: Generate 64-char hex token
const resetToken = crypto.randomBytes(32).toString('hex');

// NEW: Generate 6-digit numeric code
const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
const resetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

// Update user record:
user.resetPasswordCode = resetCode;
user.resetPasswordExpires = resetExpires;

// Update email call:
emailService.sendPasswordResetEmail(user, resetCode)
```

**Function**: `resetPassword()`

**Changes:**
```javascript
// OLD: Find by token
const user = await User.findOne({
  resetPasswordToken: token,
  resetPasswordExpires: { $gt: Date.now() }
});

// NEW: Find by code
const user = await User.findOne({
  resetPasswordCode: code,
  resetPasswordExpires: { $gt: Date.now() }
});

// Clear code after use:
user.resetPasswordCode = undefined;
user.resetPasswordExpires = undefined;
```

#### 2.3 Update Email Templates
**File**: `utils/emailService.js`

**Function**: `sendVerificationEmail()`

**Changes:**
```javascript
async function sendVerificationEmail(user, code) {
  // Remove URL generation (no longer needed)
  // OLD: const verificationUrl = `${process.env.FRONTEND_URL}/test/verify-email?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* ... existing styles ... */
        .code-box {
          background: #f0f0f0;
          border: 2px solid #667eea;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 8px;
          color: #667eea;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Welcome, ${user.firstName}!</h2>
          <p>Thank you for signing up for The1 Platform. Please verify your email address using the code below:</p>
          
          <div class="code-box">${code}</div>
          
          <p>Enter this code in the mobile app to activate your account.</p>
          <p class="warning">This code expires in 30 minutes.</p>
          <p class="warning">If you didn't create an account, please ignore this email.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Verify Your Email - The1 Platform',
    html
  });
}
```

**Function**: `sendPasswordResetEmail()`

**Changes:**
```javascript
async function sendPasswordResetEmail(user, code) {
  // Remove URL generation
  // OLD: const resetUrl = `${process.env.FRONTEND_URL}/test/reset-password?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* ... existing styles ... */
        .code-box {
          background: #f0f0f0;
          border: 2px solid #e74c3c;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 8px;
          color: #e74c3c;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Password Reset Request</h2>
          <p>Hi ${user.firstName},</p>
          <p>We received a request to reset your password. Use the code below to create a new password:</p>
          
          <div class="code-box">${code}</div>
          
          <p>Enter this code in the mobile app to reset your password.</p>
          <p class="warning">This code expires in 30 minutes.</p>
          <p class="info">If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Password Reset Code - The1 Platform',
    html
  });
}
```

#### 2.4 Update Auth Routes
**File**: `routes/auth.js`

**Endpoint**: `POST /v1/auth/verify-email`

**Changes:**
```javascript
// OLD: Validate token
const { error, value } = verifyEmailSchema.validate(req.body);
const { token } = value;

const user = await User.findOne({
  emailVerificationToken: token,
  emailVerificationExpires: { $gt: Date.now() }
});

// NEW: Validate code
const { error, value } = verifyEmailSchema.validate(req.body);
const { code } = value;

const user = await User.findOne({
  emailVerificationCode: code,
  emailVerificationExpires: { $gt: Date.now() }
});

// Clear code after verification:
user.emailVerificationCode = undefined;
user.emailVerificationExpires = undefined;
```

**Endpoint**: `POST /v1/auth/reset-password`

**Changes:**
```javascript
// OLD: Validate token
const { error, value } = resetPasswordSchema.validate(req.body);
const { token, password } = value;

const user = await User.findOne({
  resetPasswordToken: token,
  resetPasswordExpires: { $gt: Date.now() }
});

// NEW: Validate code
const { error, value } = resetPasswordSchema.validate(req.body);
const { code, password } = value;

const user = await User.findOne({
  resetPasswordCode: code,
  resetPasswordExpires: { $gt: Date.now() }
});

// Clear code after reset:
user.resetPasswordCode = undefined;
user.resetPasswordExpires = undefined;
```

#### 2.5 Update Validation Schemas
**File**: `utils/validationSchemas.js`

**Schema**: `verifyEmailSchema`

**Changes:**
```javascript
// OLD:
const verifyEmailSchema = Joi.object({
  token: Joi.string().length(64).hex().required()
});

// NEW:
const verifyEmailSchema = Joi.object({
  code: Joi.string().length(6).pattern(/^[0-9]+$/).required()
    .messages({
      'string.length': 'Verification code must be 6 digits',
      'string.pattern.base': 'Verification code must contain only numbers'
    })
});
```

**Schema**: `resetPasswordSchema`

**Changes:**
```javascript
// OLD:
const resetPasswordSchema = Joi.object({
  token: Joi.string().length(64).hex().required(),
  password: Joi.string().min(6).required()
});

// NEW:
const resetPasswordSchema = Joi.object({
  code: Joi.string().length(6).pattern(/^[0-9]+$/).required()
    .messages({
      'string.length': 'Reset code must be 6 digits',
      'string.pattern.base': 'Reset code must contain only numbers'
    }),
  password: Joi.string().min(6).required()
});
```

---

### **Phase 3: Update Mobile App**

#### 3.1 Verify Email Screen
**File**: `mobile/app/verify-email.js`

**Current State**: Already expects code input (good!)

**Updates Needed:**
- Ensure API call sends `code` instead of `token`
- Update error messages if needed
- Verify input validation (6 digits, numeric only)

**Check:**
```javascript
// Should be:
const response = await apiPost('/auth/verify-email', {code: token});

// Not:
const response = await apiPost('/auth/verify-email', {token: token});
```

**Input Validation:**
```javascript
// Add validation for 6-digit numeric code
if (!token || token.length !== 6 || !/^\d+$/.test(token)) {
  setError('Please enter a valid 6-digit code');
  return;
}
```

#### 3.2 Reset Password Screen
**File**: `mobile/app/reset-password.js`

**Current State**: May expect token from URL params

**Updates Needed:**
- Change to code input field (similar to verify-email)
- Remove token extraction from URL params
- Update API call to send `code` instead of `token`
- Add code input validation

**Changes:**
```javascript
// Remove token from params:
// OLD: const token = params.token;

// Add code state:
const [code, setCode] = useState('');

// Update API call:
const response = await apiPost('/auth/reset-password', {
  code: code,
  password: newPassword
});
```

#### 3.3 Signup Screen
**File**: `mobile/app/signup.js`

**Current State**: Already navigates to verify-email screen (good!)

**Updates Needed:**
- Ensure error messages are clear
- Verify navigation passes email correctly

**Check:**
```javascript
// Should pass email for resend functionality:
router.replace({
  pathname: '/verify-email',
  params: {email: formData.email},
});
```

#### 3.4 Forgot Password Screen
**File**: `mobile/app/forgot-password.js`

**Current State**: Already calls `/auth/forgot-password` (good!)

**Updates Needed:**
- After successful request, navigate to reset-password screen
- Pass email for context (optional)

**Changes:**
```javascript
if (response.success) {
  // Navigate to reset password screen with email context
  router.push({
    pathname: '/reset-password',
    params: {email: email}
  });
}
```

---

### **Phase 4: Testing & Validation**

#### 4.1 Email Service Testing
- [ ] Test email service with `/test/email-test` endpoint
- [ ] Verify AWS SES credentials are working
- [ ] Check email delivery in inbox (not spam)
- [ ] Verify email formatting (codes display correctly)

#### 4.2 Signup Flow Testing
- [ ] Create new account via mobile app
- [ ] Verify email is received with 6-digit code
- [ ] Enter code in mobile app
- [ ] Verify account is activated
- [ ] Test resend verification code
- [ ] Test expired code handling
- [ ] Test invalid code handling

#### 4.3 Forgot Password Flow Testing
- [ ] Request password reset via mobile app
- [ ] Verify email is received with 6-digit code
- [ ] Enter code and new password in mobile app
- [ ] Verify password is reset successfully
- [ ] Test expired code handling
- [ ] Test invalid code handling
- [ ] Test login with new password

#### 4.4 Error Handling Testing
- [ ] Test with missing AWS credentials
- [ ] Test with invalid email address
- [ ] Test with expired codes
- [ ] Test with invalid codes
- [ ] Test with already verified email
- [ ] Test with non-existent email (forgot password)

---

## Environment Variables Checklist

### Required Variables (`.env`):
```bash
# AWS SES Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-west-2

# Email Configuration
FROM_EMAIL=noreply@the1.vip  # Must be verified in AWS SES

# Optional (for email links if needed later)
FRONTEND_URL=http://localhost:3000
```

### AWS SES Setup Steps:
1. Go to AWS SES Console
2. Verify `FROM_EMAIL` domain or email address
3. Request production access if in sandbox mode
4. Create IAM user with SES permissions
5. Add credentials to `.env` file

---

## Migration Notes

### Database Migration
If existing users have old token-based verification:
- Old tokens will be invalid after migration
- Users will need to request new verification codes
- Consider adding migration script to clear old tokens

### Backward Compatibility
- Old token-based endpoints will stop working
- Mobile app must be updated before server deployment
- Or maintain both methods temporarily during transition

---

## Implementation Order

1. **Phase 1**: Diagnose email service (add test endpoint, enhanced logging)
2. **Phase 2.1-2.2**: Update server models and services (code generation)
3. **Phase 2.3**: Update email templates (show codes)
4. **Phase 2.4-2.5**: Update routes and validation (accept codes)
5. **Phase 3**: Update mobile app (ensure code input works)
6. **Phase 4**: Test everything end-to-end

---

## Success Criteria

- [ ] Emails are successfully sent via AWS SES
- [ ] Verification codes are 6-digit numeric
- [ ] Codes expire after 30 minutes
- [ ] Mobile app can verify email with code
- [ ] Mobile app can reset password with code
- [ ] Error messages are clear and helpful
- [ ] All edge cases are handled gracefully

---

## Estimated Time

- **Phase 1** (Diagnostics): 1-2 hours
- **Phase 2** (Server Updates): 3-4 hours
- **Phase 3** (Mobile Updates): 1-2 hours
- **Phase 4** (Testing): 2-3 hours

**Total**: 7-11 hours

---

## Notes

- Keep code expiration short (30 minutes) for security
- Consider rate limiting code requests to prevent abuse
- Log all code generation and verification attempts for security auditing
- Monitor email delivery rates and bounce rates in AWS SES

---

## Related Files

### Server:
- `models/User.js` - User schema
- `services/authService.js` - Auth logic
- `routes/auth.js` - Auth endpoints
- `utils/emailService.js` - Email sending
- `utils/validationSchemas.js` - Input validation

### Mobile:
- `mobile/app/signup.js` - Signup screen
- `mobile/app/verify-email.js` - Email verification screen
- `mobile/app/forgot-password.js` - Forgot password screen
- `mobile/app/reset-password.js` - Reset password screen
- `mobile/src/api/client.js` - API client

---

**Last Updated**: 2025-01-XX
**Status**: Planning Phase

