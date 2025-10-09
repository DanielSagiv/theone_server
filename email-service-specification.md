# Email Service Specification

## Overview
This document outlines the email service architecture for The1 Platform, providing a centralized, reusable system for sending all types of emails throughout the application.

---

## Architecture

### Core Components

1. **Email Service (`utils/emailService.js`)**
   - Core email sending functionality
   - AWS SES integration via nodemailer
   - Email template functions
   - Utility functions for formatting

2. **Email Templates**
   - HTML-based email templates
   - Consistent branding and styling
   - Responsive design for mobile devices
   - Plain text fallbacks

3. **Configuration**
   - Environment variables for settings
   - AWS SES configuration
   - Email sender verification

---

## Technical Implementation

### Dependencies

```json
{
  "aws-sdk": "^2.1692.0"
}
```

### Installation

No additional dependencies needed - `aws-sdk` is already installed.

---

## Email Service Functions

### Core Function

#### `sendEmail(options)`
**Purpose**: Generic function to send any email

**Parameters**:
```javascript
{
  to: string,           // Recipient email address
  subject: string,      // Email subject line
  html: string,         // HTML content
  text?: string,        // Plain text content (optional, auto-generated if not provided)
  attachments?: Array   // Optional attachments
}
```

**Returns**: `Promise<Object>` - Send result with messageId

**Usage**:
```javascript
await sendEmail({
  to: 'user@example.com',
  subject: 'Custom Email',
  html: '<h1>Hello</h1><p>Custom content</p>'
});
```

---

### Template Functions

#### 1. `sendVerificationEmail(user, token)`
**Purpose**: Send email verification link to new users

**Parameters**:
- `user` (Object): User object with email, firstName, lastName
- `token` (String): Verification token (32-byte hex string)

**Template**: Email verification with branded button
**Expiry**: 24 hours
**Link Format**: `{FRONTEND_URL}/verify-email?token={token}`

---

#### 2. `sendPasswordResetEmail(user, token)`
**Purpose**: Send password reset link to users

**Parameters**:
- `user` (Object): User object
- `token` (String): Reset token

**Template**: Password reset with security notice
**Expiry**: 1 hour
**Link Format**: `{FRONTEND_URL}/reset-password?token={token}`

---

#### 3. `sendWelcomeEmail(user)`
**Purpose**: Send welcome email after successful verification

**Parameters**:
- `user` (Object): User object

**Template**: Welcome message with platform introduction
**Call Time**: After email verification is complete

---

#### 4. `sendCOEInvitationEmail(client, coe, adminNote)`
**Purpose**: Send COE invitation to clients

**Parameters**:
- `client` (Object): Client user object
- `coe` (Object): COE object with details
- `adminNote` (String, optional): Personalized note from admin

**Template**: Professional COE invitation with details and pricing
**Link Format**: `{FRONTEND_URL}/coe/{coeId}`

---

#### 5. `sendBookingConfirmationEmail(user, event, seat)`
**Purpose**: Send booking confirmation

**Parameters**:
- `user` (Object): User who made the booking
- `event` (Object): Event details
- `seat` (Object): Seat/table details

**Template**: Booking confirmation with event details
**Call Time**: After successful booking

---

#### 6. `sendAdminNotificationEmail(adminEmail, subject, message)`
**Purpose**: Send notifications to administrators

**Parameters**:
- `adminEmail` (String): Admin email address
- `subject` (String): Notification subject
- `message` (String): Notification message

**Template**: Simple admin notification format
**Use Cases**: New signups, important events, system alerts

---

## Email Template Structure

### Standard Template Layout

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      font-family: Arial, sans-serif; 
      line-height: 1.6; 
      color: #333; 
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px; 
    }
    .header { 
      background: linear-gradient(135deg, #667eea, #764ba2); 
      color: white; 
      padding: 30px; 
      text-align: center; 
      border-radius: 10px 10px 0 0; 
    }
    .content { 
      background: #f9f9f9; 
      padding: 30px; 
      border-radius: 0 0 10px 10px; 
    }
    .button { 
      display: inline-block; 
      background: #667eea; 
      color: white; 
      padding: 15px 30px; 
      text-decoration: none; 
      border-radius: 5px; 
      margin: 20px 0; 
    }
    .footer { 
      text-align: center; 
      color: #666; 
      font-size: 12px; 
      margin-top: 20px; 
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>The1 Platform</h1>
    </div>
    <div class="content">
      <!-- Email content here -->
    </div>
    <div class="footer">
      © 2025 The1 Platform. All rights reserved.
    </div>
  </div>
</body>
</html>
```

### Design Guidelines

1. **Branding**
   - Use platform gradient colors (#667eea, #764ba2)
   - Include The1 Platform logo/name in header
   - Consistent typography and spacing

2. **Responsive Design**
   - Max width: 600px for email clients
   - Mobile-friendly buttons and text
   - Proper padding and margins

3. **Accessibility**
   - Plain text alternatives
   - Proper heading hierarchy
   - High contrast text

4. **Security**
   - Clear sender identification
   - Expiry times for time-sensitive links
   - Warning text for suspicious emails

---

## AWS SES Configuration

### Setup Steps

1. **Verify Sender Email**
   - Go to AWS SES Console
   - Verify email address: `noreply@the1platform.com`
   - Check verification email and click link

2. **Move Out of Sandbox** (Production)
   - Submit request to AWS Support
   - Required for sending to unverified recipients
   - Takes 24-48 hours for approval

3. **IAM Permissions**
   Required permissions for the AWS user/role:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ses:SendEmail",
           "ses:SendRawEmail"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

4. **Configure DNS** (For custom domain)
   - Add SPF record
   - Add DKIM records
   - Add DMARC policy
   - Improves deliverability

---

## Environment Variables

### Required Variables

```bash
# Email Configuration
FROM_EMAIL=noreply@the1platform.com
FRONTEND_URL=https://yourdomain.com

# AWS Configuration (already exists)
AWS_REGION=us-west-2

# AWS Credentials (use IAM role in production)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Local Development

For local development, you can use:
- AWS SES sandbox (verified emails only)
- Mailgun/SendGrid for testing
- Ethereal.email for testing (fake SMTP)

---

## Error Handling

### Email Send Failures

```javascript
try {
  await emailService.sendVerificationEmail(user, token);
} catch (error) {
  // Log error but don't block user registration
  console.error('Email send error:', {
    to: user.email,
    error: error.message,
    timestamp: new Date().toISOString()
  });
  
  // User can still resend verification later
  // Don't throw error - email is non-critical for signup
}
```

### Best Practices

1. **Async Non-Blocking**: Don't wait for email to send during user requests
2. **Retry Logic**: Implement exponential backoff for failures
3. **Logging**: Log all email attempts with timestamps
4. **Rate Limiting**: Respect AWS SES sending limits
5. **Bounce Handling**: Monitor bounces and mark invalid emails

---

## Monitoring & Analytics

### Key Metrics

1. **Delivery Rate**: % of emails successfully delivered
2. **Bounce Rate**: % of emails that bounced
3. **Open Rate**: % of emails opened (if tracking enabled)
4. **Click Rate**: % of links clicked in emails
5. **Complaint Rate**: % of emails marked as spam

### AWS CloudWatch Integration

Monitor SES metrics:
- Send count
- Bounce count
- Complaint count
- Reject count

Set up alarms for unusual activity.

---

## Cost Estimation

### AWS SES Pricing

- **From EC2/Lambda**: First 62,000 emails/month FREE
- **From other sources**: $0.10 per 1,000 emails
- **Data transfer**: $0.12/GB (outbound)

### Example Costs

| Monthly Emails | Cost (from EC2) | Cost (external) |
|----------------|-----------------|-----------------|
| 10,000         | FREE            | $1.00           |
| 50,000         | FREE            | $5.00           |
| 100,000        | $3.80           | $10.00          |
| 500,000        | $43.80          | $50.00          |

---

## Testing

### Unit Tests

```javascript
// Test email service
describe('Email Service', () => {
  it('should send email successfully', async () => {
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Test</p>'
    });
    expect(result.messageId).toBeDefined();
  });
  
  it('should generate verification email', async () => {
    const user = { email: 'user@example.com', firstName: 'John' };
    const token = 'test-token-123';
    await sendVerificationEmail(user, token);
    // Verify email was queued
  });
});
```

### Integration Tests

1. Send test emails to verified addresses
2. Check email delivery in inbox
3. Verify link functionality
4. Test email rendering across clients (Gmail, Outlook, Apple Mail)

---

## Security Considerations

### Best Practices

1. **Token Security**
   - Use cryptographically secure random tokens
   - Minimum 32 bytes for verification tokens
   - Set expiration times (24h for verification, 1h for password reset)

2. **Rate Limiting**
   - Limit emails per user per hour
   - Prevent spam/abuse
   - Implement CAPTCHA for resend requests

3. **Data Protection**
   - Never include passwords in emails
   - Be careful with PII in email content
   - Use HTTPS for all links

4. **Email Spoofing Prevention**
   - Configure SPF records
   - Enable DKIM signing
   - Set up DMARC policy

---

## Troubleshooting

### Common Issues

1. **Emails Not Sending**
   - Check AWS credentials
   - Verify sender email in SES
   - Check SES sandbox status
   - Review IAM permissions

2. **Emails Going to Spam**
   - Verify SPF/DKIM/DMARC records
   - Check email content for spam triggers
   - Monitor bounce/complaint rates
   - Request removal from blacklists

3. **Slow Email Delivery**
   - Check SES sending limits
   - Review CloudWatch metrics
   - Implement email queuing system

4. **Template Rendering Issues**
   - Test across email clients
   - Use inline CSS (avoid external stylesheets)
   - Avoid JavaScript (not supported in emails)

---

## Future Enhancements

### Phase 2 Features

1. **Email Queue System**
   - Use AWS SQS for email queuing
   - Batch processing for bulk emails
   - Retry logic with exponential backoff

2. **Email Templates in Database**
   - Store templates in MongoDB
   - Admin interface to edit templates
   - A/B testing for email content

3. **Email Tracking**
   - Open tracking (pixel)
   - Click tracking (redirect links)
   - Unsubscribe management

4. **Personalization**
   - Dynamic content based on user data
   - Segmented email campaigns
   - User preference management

5. **Multi-Language Support**
   - Localized email templates
   - Language detection from user profile
   - Translation management

---

## References

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [Nodemailer Documentation](https://nodemailer.com/)
- [Email Design Best Practices](https://www.campaignmonitor.com/best-practices/)
- [Can I Email (CSS Support)](https://www.caniemail.com/)

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-08  
**Author**: The1 Platform Development Team

