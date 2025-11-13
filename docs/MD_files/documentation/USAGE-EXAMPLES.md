# Email Service Usage Examples

This document provides practical examples of how to use the email service in different parts of The1 Platform.

---

## 📧 Basic Import

```javascript
const emailService = require('../utils/emailService');
```

---

## 1️⃣ User Signup Flow

### In `services/authService.js`

```javascript
const crypto = require('crypto');
const emailService = require('../utils/emailService');

const registerUser = async (userData) => {
  try {
    // Create user
    const user = new User(userData);
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await user.save();

    // Send verification email (non-blocking)
    emailService.sendVerificationEmail(user, verificationToken)
      .then(() => console.log('Verification email sent to:', user.email))
      .catch(err => console.error('Email error:', err));

    return user.getProfile();
  } catch (error) {
    throw error;
  }
};
```

---

## 2️⃣ Email Verification

### In `routes/auth.js`

```javascript
const emailService = require('../utils/emailService');

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    // Find and verify user
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }

    // Mark as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    // Send welcome email
    emailService.sendWelcomeEmail(user)
      .catch(err => console.error('Welcome email error:', err));

    res.json({ success: true, message: 'Email verified!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## 3️⃣ Password Reset Flow

### In `services/authService.js`

```javascript
const crypto = require('crypto');
const emailService = require('../utils/emailService');

const requestPasswordReset = async (email) => {
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Don't reveal if user exists (security)
      return { message: 'If email exists, reset link sent' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    await emailService.sendPasswordResetEmail(user, resetToken);

    return { message: 'Password reset email sent' };
  } catch (error) {
    throw error;
  }
};
```

---

## 4️⃣ Event Booking Confirmation

### In `services/eventService.js`

```javascript
const emailService = require('../utils/emailService');

const bookEventSeat = async (userId, eventId, seatId) => {
  try {
    // Get user, event, and seat data
    const user = await User.findById(userId);
    const event = await Event.findById(eventId).populate('location_id');
    const seat = event.seats.id(seatId);

    // Create booking
    seat.status = 'booked';
    seat.booked_by = userId;
    seat.booked_at = new Date();
    await event.save();

    // Send confirmation email
    emailService.sendBookingConfirmationEmail(user, event, seat)
      .then(() => console.log('Booking confirmation sent'))
      .catch(err => console.error('Booking email error:', err));

    // Notify admin
    emailService.sendAdminNotificationEmail(
      'admin@the1.vip',
      'New Booking',
      `${user.firstName} ${user.lastName} booked ${event.name} - ${seat.code}`
    ).catch(err => console.error('Admin notification error:', err));

    return { success: true, booking: seat };
  } catch (error) {
    throw error;
  }
};
```

---

## 5️⃣ COE Invitation

### In `services/coeService.js`

```javascript
const emailService = require('../utils/emailService');

const sendCOEToClient = async (coeId, clientId, adminNote) => {
  try {
    const coe = await COE.findById(coeId)
      .populate('client_id')
      .populate('events.event_id');
    
    const client = await User.findById(clientId);

    // Send COE invitation email
    await emailService.sendCOEInvitationEmail(client, coe, adminNote);

    // Update COE status
    coe.status = 'sent';
    coe.sent_at = new Date();
    await coe.save();

    return { success: true, message: 'COE sent to client' };
  } catch (error) {
    throw error;
  }
};
```

---

## 6️⃣ Admin Notifications

### In `routes/users.js`

```javascript
const emailService = require('../utils/emailService');

router.post('/signup', async (req, res) => {
  try {
    const user = await User.create(req.body);

    // Notify admin of new signup
    emailService.sendAdminNotificationEmail(
      'admin@the1.vip',
      'New User Signup',
      `New user registered: ${user.firstName} ${user.lastName} (${user.email})`
    ).catch(err => console.error('Admin notification error:', err));

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## 7️⃣ Custom Emails

### Send any custom email

```javascript
const emailService = require('../utils/emailService');

// Example: Send VIP upgrade notification
const notifyVIPUpgrade = async (user) => {
  await emailService.sendEmail({
    to: user.email,
    subject: 'Congratulations! You are now VIP',
    html: `
      <h1>Welcome to VIP, ${user.firstName}!</h1>
      <p>Your account has been upgraded to VIP status.</p>
      <p>Enjoy exclusive benefits and priority access to events.</p>
    `
  });
};

// Example: Send event reminder
const sendEventReminder = async (user, event) => {
  const eventDate = new Date(event.start_datetime).toLocaleDateString();
  
  await emailService.sendEmail({
    to: user.email,
    subject: `Reminder: ${event.name} is tomorrow!`,
    html: `
      <h2>Event Reminder</h2>
      <p>Hi ${user.firstName},</p>
      <p>Don't forget! ${event.name} is happening tomorrow at ${event.location_id.name}.</p>
      <p>Date: ${eventDate}</p>
      <p>We look forward to seeing you there!</p>
    `
  });
};

// Example: Send bulk email to all users
const sendAnnouncementToAllUsers = async (subject, message) => {
  const users = await User.find({ emailVerified: true, isActive: true });
  
  for (const user of users) {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject,
        html: `<p>Hi ${user.firstName},</p>${message}`
      });
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Failed to send to ${user.email}:`, error);
    }
  }
};
```

---

## 8️⃣ Error Handling Best Practices

### Non-blocking email sending

```javascript
// Good: Don't wait for email, don't block user flow
emailService.sendVerificationEmail(user, token)
  .then(() => console.log('Email sent'))
  .catch(err => console.error('Email failed:', err));

// Continue with user registration
return { success: true, user: user.getProfile() };
```

### Critical emails (wait for confirmation)

```javascript
// For critical emails, wait and handle errors
try {
  await emailService.sendBookingConfirmationEmail(user, event, seat);
  return { success: true, message: 'Booking confirmed, email sent' };
} catch (emailError) {
  // Booking still succeeded, but email failed
  console.error('Email error:', emailError);
  return { 
    success: true, 
    message: 'Booking confirmed, email failed to send',
    warning: 'Please check your email settings'
  };
}
```

### Retry logic

```javascript
const sendEmailWithRetry = async (emailFn, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await emailFn();
      return { success: true };
    } catch (error) {
      console.error(`Email attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        throw error;
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};

// Usage
await sendEmailWithRetry(() => 
  emailService.sendVerificationEmail(user, token)
);
```

---

## 9️⃣ Testing in Development

### Mock email service for tests

```javascript
// test/mocks/emailService.js
const emailService = {
  sendEmail: async () => ({ messageId: 'test-123' }),
  sendVerificationEmail: async () => ({ messageId: 'test-123' }),
  sendPasswordResetEmail: async () => ({ messageId: 'test-123' }),
  sendWelcomeEmail: async () => ({ messageId: 'test-123' }),
  sendCOEInvitationEmail: async () => ({ messageId: 'test-123' }),
  sendBookingConfirmationEmail: async () => ({ messageId: 'test-123' }),
  sendAdminNotificationEmail: async () => ({ messageId: 'test-123' })
};

module.exports = emailService;
```

### Use mock in tests

```javascript
// In your test file
jest.mock('../utils/emailService');
const emailService = require('../utils/emailService');

test('user registration sends verification email', async () => {
  const user = await registerUser(userData);
  
  expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({ email: userData.email }),
    expect.any(String)
  );
});
```

---

## 🔟 Rate Limiting

### Prevent email spam

```javascript
const rateLimit = new Map();

const canSendEmail = (userId, type) => {
  const key = `${userId}:${type}`;
  const lastSent = rateLimit.get(key);
  
  if (lastSent && Date.now() - lastSent < 5 * 60 * 1000) {
    // Less than 5 minutes since last email
    return false;
  }
  
  rateLimit.set(key, Date.now());
  return true;
};

// Usage
if (canSendEmail(user._id, 'verification')) {
  await emailService.sendVerificationEmail(user, token);
} else {
  throw new Error('Please wait 5 minutes before requesting another email');
}
```

---

## 📋 Quick Reference

| Function | Use Case | When to Call |
|----------|----------|--------------|
| `sendEmail` | Any custom email | Anytime |
| `sendVerificationEmail` | Email verification | User signup |
| `sendPasswordResetEmail` | Password reset | User requests reset |
| `sendWelcomeEmail` | Welcome message | After email verified |
| `sendCOEInvitationEmail` | COE proposals | Admin sends COE |
| `sendBookingConfirmationEmail` | Booking confirmation | After successful booking |
| `sendAdminNotificationEmail` | Admin alerts | Important events |

---

## 🎯 Best Practices

1. **Always handle errors** - Email failures shouldn't break your app
2. **Don't block user flow** - Send emails asynchronously when possible
3. **Log all attempts** - Track email sends for debugging
4. **Rate limit** - Prevent spam and abuse
5. **Test thoroughly** - Verify emails in sandbox before production
6. **Monitor metrics** - Watch bounce and complaint rates
7. **Use templates** - Pre-built templates for consistency
8. **Personalize** - Use user's name and relevant data

---

**For more details, see**:
- [Email Service Setup Guide](./EMAIL-SERVICE-SETUP.md)
- [Email Service Specification](./email-service-specification.md)
- [Email Verification Specification](./email-verification-specification.md)

