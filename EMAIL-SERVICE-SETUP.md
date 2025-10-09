# Email Service Setup Guide

## Overview
This guide will help you set up and test the email service for The1 Platform using AWS SES.

---

## 📋 Prerequisites

1. **AWS Account** with SES access
2. **Domain**: the1.vip (or verified email for testing)
3. **Node.js** and npm installed
4. **Environment variables** configured

---

## 🚀 Quick Start

### Step 1: Dependencies

```bash
npm install
```

Dependencies:
- `aws-sdk` - AWS SDK for SES email sending (already installed)

### Step 2: Configure Environment Variables

Create a `.env` file in the root directory with:

```bash
# Email Configuration
FROM_EMAIL=noreply@the1.vip
FRONTEND_URL=http://localhost:3006

# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key

# Existing variables (keep these)
DB_URI=your-mongodb-connection-string
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
NODE_ENV=development
```

### Step 3: Verify Email in AWS SES (Sandbox Mode)

For testing in sandbox mode, verify your test email:

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Select region: **us-west-2** (or your preferred region)
3. Click **"Verified identities"** → **"Create identity"**
4. Choose **"Email address"**
5. Enter your test email (e.g., `sagiv.daniel.p@gmail.com`)
6. Click **"Create identity"**
7. Check your inbox and click the verification link

### Step 4: Test the Email Service

1. **Update test email**:
   Edit `test-email.js` and change:
   ```javascript
   const TEST_EMAIL = 'your-verified-email@example.com';
   ```
   to your verified email.

2. **Run the test**:
   ```bash
   node test-email.js
   ```

3. **Check results**:
   - Console will show test results
   - Check your inbox for 5 test emails

---

## 📧 Available Email Functions

### 1. Send Any Email (Generic)
```javascript
const emailService = require('./utils/emailService');

await emailService.sendEmail({
  to: 'user@example.com',
  subject: 'Your Subject',
  html: '<h1>Your HTML content</h1>'
});
```

### 2. Send Verification Email
```javascript
await emailService.sendVerificationEmail(user, verificationToken);
```

### 3. Send Password Reset Email
```javascript
await emailService.sendPasswordResetEmail(user, resetToken);
```

### 4. Send Welcome Email
```javascript
await emailService.sendWelcomeEmail(user);
```

### 5. Send COE Invitation
```javascript
await emailService.sendCOEInvitationEmail(client, coe, adminNote);
```

### 6. Send Booking Confirmation
```javascript
await emailService.sendBookingConfirmationEmail(user, event, seat);
```

### 7. Send Admin Notification
```javascript
await emailService.sendAdminNotificationEmail(
  'admin@the1.vip',
  'Subject',
  'Message'
);
```

---

## 🔧 AWS SES Configuration

### For Local Development (Sandbox Mode)

**Current Status**: Can only send to verified emails

**To verify an email**:
1. AWS SES Console → Verified identities
2. Create identity → Email address
3. Enter email and verify

### For Production (Exit Sandbox)

**Required for**: Sending to any email address

**Steps**:
1. Go to AWS SES Console → Account dashboard
2. Click **"Request production access"**
3. Fill out the form:
   - **Mail Type**: Transactional
   - **Website URL**: https://the1.vip
   - **Use Case**: Describe your email needs (see example below)
4. Submit request
5. Wait 24-48 hours for approval

**Use Case Example**:
```
The1 Platform is a premium event management system. We send transactional 
emails including email verification, password resets, booking confirmations, 
and event notifications. Estimated volume: 500-1000 emails/day. All emails 
are opt-in and users can contact support@the1.vip for assistance.
```

---

## 🌐 Domain Verification (Production)

### Verify the1.vip Domain

1. **In AWS SES Console**:
   - Verified identities → Create identity
   - Choose **Domain**
   - Enter: `the1.vip`
   - Enable DKIM signing
   - Click Create

2. **Add DNS Records**:
   AWS will provide DNS records. Add these to your domain registrar:

   **DKIM Records** (3 CNAME records):
   ```
   Type: CNAME
   Name: xxx._domainkey.the1.vip
   Value: xxx.dkim.amazonses.com
   ```

   **SPF Record** (TXT record):
   ```
   Type: TXT
   Name: the1.vip
   Value: v=spf1 include:amazonses.com ~all
   ```

   **DMARC Record** (TXT record):
   ```
   Type: TXT
   Name: _dmarc.the1.vip
   Value: v=DMARC1; p=quarantine; rua=mailto:admin@the1.vip
   ```

3. **Wait for Verification**:
   - DNS propagation: 1-24 hours
   - Check status in AWS SES Console

---

## 🔐 IAM Permissions

### Create IAM User for Email Service

1. **Go to IAM Console** → Users → Create user
2. **User name**: `the1-ses-user`
3. **Attach policy**: `AmazonSESFullAccess`
4. **Create access key**:
   - Go to Security credentials tab
   - Create access key
   - Choose "Application running outside AWS"
   - Copy Access Key ID and Secret Access Key
5. **Add to .env file**

### IAM Policy (if creating custom policy):
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

---

## 🧪 Testing

### Manual Testing Checklist

- [ ] Configuration validated (run test-email.js)
- [ ] Simple email received
- [ ] Verification email received with working link
- [ ] Password reset email received
- [ ] Welcome email received
- [ ] Admin notification received
- [ ] Email renders correctly in Gmail
- [ ] Email renders correctly in Outlook
- [ ] Email renders correctly on mobile

### Test Different Scenarios

```javascript
// Test 1: User signup flow
const user = {
  email: 'test@example.com',
  firstName: 'John'
};
const token = crypto.randomBytes(32).toString('hex');
await emailService.sendVerificationEmail(user, token);

// Test 2: Password reset flow
await emailService.sendPasswordResetEmail(user, token);

// Test 3: Post-verification welcome
await emailService.sendWelcomeEmail(user);
```

---

## 🐛 Troubleshooting

### Issue: "Email not sent"

**Check**:
1. AWS credentials in .env file
2. Email verified in SES (if sandbox mode)
3. Region matches (us-west-2)
4. Network connectivity

**Solution**:
```bash
# Verify credentials work
aws ses verify-email-identity --email-address test@example.com --region us-west-2
```

### Issue: "Invalid credentials"

**Check**:
1. AWS_ACCESS_KEY_ID is correct
2. AWS_SECRET_ACCESS_KEY is correct
3. IAM user has SES permissions

**Solution**:
- Regenerate access keys in IAM Console
- Update .env file

### Issue: "Email goes to spam"

**Check**:
1. SPF record configured
2. DKIM records configured
3. DMARC policy set
4. Domain verified

**Solution**:
- Verify all DNS records are correct
- Use [mail-tester.com](https://www.mail-tester.com/) to check spam score
- Warm up sending (start with low volume)

### Issue: "MessageRejected: Email address not verified"

**Status**: Sandbox mode restriction

**Solution**:
1. Verify email in SES Console, OR
2. Request production access to exit sandbox

---

## 💰 Cost

### AWS SES Pricing
- **From EC2/ECS/Lambda**: First 62,000 emails/month **FREE**
- **From other sources**: $0.10 per 1,000 emails
- **Data transfer**: ~$0.12/GB (negligible)

### Expected Monthly Cost
| Users | Emails/Month | Cost |
|-------|--------------|------|
| 100   | 5,000        | FREE |
| 500   | 25,000       | FREE |
| 1,000 | 50,000       | FREE |
| 2,000 | 100,000      | $3.80 |
| 5,000 | 250,000      | $18.80 |

---

## 📊 Monitoring

### AWS CloudWatch Metrics

Monitor in AWS SES Console → Account dashboard:
- Send count
- Delivery rate
- Bounce rate
- Complaint rate

### Set Up Alarms

Create CloudWatch alarms for:
- Bounce rate > 5%
- Complaint rate > 0.1%
- Send failures

---

## 🔄 Next Steps

### Phase 1: Basic Setup ✅
- [x] Install nodemailer
- [x] Create email service
- [x] Test email sending

### Phase 2: Production Setup
- [ ] Verify domain the1.vip in AWS SES
- [ ] Add DNS records to domain
- [ ] Request production access
- [ ] Set up bounce/complaint handling

### Phase 3: Integration
- [ ] Integrate with signup flow
- [ ] Add email verification to login
- [ ] Add password reset flow
- [ ] Add booking confirmation emails

### Phase 4: Enhancement
- [ ] Add email templates to database
- [ ] Implement email queue (SQS)
- [ ] Add email tracking (opens, clicks)
- [ ] Add unsubscribe management

---

## 📚 Resources

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [Nodemailer Documentation](https://nodemailer.com/)
- [Email Service Specification](./email-service-specification.md)
- [Email Verification Specification](./email-verification-specification.md)

---

## 🆘 Support

For issues or questions:
1. Check this guide first
2. Review error messages in console
3. Check AWS SES Console for delivery status
4. Review CloudWatch logs

---

**Last Updated**: 2025-10-08  
**Status**: Ready for Testing

