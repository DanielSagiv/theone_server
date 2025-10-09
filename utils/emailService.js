/**
 * Email Service
 * Centralized service for sending all types of emails via AWS SES
 * @description Provides reusable email functions with branded templates
 */

const AWS = require('aws-sdk');

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-west-2'
});

// Create SES service instance
const ses = new AWS.SES({ apiVersion: '2010-12-01' });

/**
 * CORE FUNCTION: Send any email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 * @returns {Promise<Object>} Send result with messageId
 */
async function sendEmail({ to, subject, html, text }) {
  try {
    const params = {
      Source: process.env.FROM_EMAIL || 'noreply@the1.vip',
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: html,
            Charset: 'UTF-8'
          },
          Text: {
            Data: text || stripHtml(html),
            Charset: 'UTF-8'
          }
        }
      }
    };

    const result = await ses.sendEmail(params).promise();
    console.log('Email sent successfully:', { 
      to, 
      subject, 
      messageId: result.MessageId,
      timestamp: new Date().toISOString()
    });
    return { messageId: result.MessageId };
  } catch (error) {
    console.error('Email send error:', { 
      to, 
      subject, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * EMAIL TEMPLATE FUNCTIONS
 * Pre-built email templates for common use cases
 */

/**
 * Send email verification email
 * @param {Object} user - User object with email, firstName
 * @param {string} token - Verification token (32-byte hex string)
 * @returns {Promise<Object>} Send result
 */
async function sendVerificationEmail(user, token) {
  const verificationUrl = `${process.env.FRONTEND_URL}/test/verify-email?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .content h2 { color: #2c3e50; margin-top: 0; }
        .button { display: inline-block; background: #667eea; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #5568d3; }
        .link-text { color: #666; font-size: 14px; word-break: break-all; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
        .warning { color: #999; font-size: 12px; font-style: italic; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Welcome, ${user.firstName}!</h2>
          <p>Thank you for signing up for The1 Platform. Please verify your email address to activate your account and start enjoying exclusive event experiences.</p>
          <p style="text-align: center;">
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
          </p>
          <p class="link-text">Or copy and paste this link into your browser:<br><a href="${verificationUrl}">${verificationUrl}</a></p>
          <p class="warning">This link expires in 24 hours.</p>
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

/**
 * Send password reset email
 * @param {Object} user - User object
 * @param {string} token - Reset token
 * @returns {Promise<Object>} Send result
 */
async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/test/reset-password?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .content h2 { color: #2c3e50; margin-top: 0; }
        .button { display: inline-block; background: #e74c3c; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #c0392b; }
        .link-text { color: #666; font-size: 14px; word-break: break-all; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
        .warning { color: #e74c3c; font-size: 12px; font-weight: bold; margin-top: 20px; }
        .info { color: #999; font-size: 12px; font-style: italic; margin-top: 10px; }
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
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </p>
          <p class="link-text">Or copy and paste this link into your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
          <p class="warning">This link expires in 1 hour.</p>
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
    subject: 'Password Reset Request - The1 Platform',
    html
  });
}

/**
 * Send welcome email after verification
 * @param {Object} user - User object
 * @returns {Promise<Object>} Send result
 */
async function sendWelcomeEmail(user) {
  const dashboardUrl = `${process.env.FRONTEND_URL}/test/dashboard`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .content h2 { color: #2c3e50; margin-top: 0; }
        .button { display: inline-block; background: #27ae60; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #229954; }
        .features { margin: 20px 0; }
        .feature-item { margin: 10px 0; padding-left: 20px; position: relative; }
        .feature-item:before { content: "✓"; position: absolute; left: 0; color: #27ae60; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Welcome to The1 Platform!</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your email has been verified successfully. You're all set to start exploring premium events and exclusive experiences!</p>
          <div class="features">
            <p><strong>What you can do now:</strong></p>
            <div class="feature-item">Browse exclusive events and venues</div>
            <div class="feature-item">Book premium tables and experiences</div>
            <div class="feature-item">Manage your bookings and profile</div>
            <div class="feature-item">Receive personalized event recommendations</div>
          </div>
          <p style="text-align: center;">
            <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
          </p>
          <p>If you have any questions, feel free to reach out to our support team.</p>
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
    subject: 'Welcome to The1 Platform',
    html
  });
}

/**
 * Send COE invitation email to client
 * @param {Object} client - Client user object
 * @param {Object} coe - COE object with details
 * @param {string} adminNote - Optional personalized note from admin
 * @returns {Promise<Object>} Send result
 */
async function sendCOEInvitationEmail(client, coe, adminNote = '') {
  const coeUrl = `${process.env.FRONTEND_URL}/coe/${coe._id}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .content h2 { color: #2c3e50; margin-top: 0; }
        .coe-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .detail-row { margin: 10px 0; }
        .detail-label { font-weight: bold; color: #666; }
        .price { font-size: 24px; color: #27ae60; font-weight: bold; margin: 20px 0; }
        .button { display: inline-block; background: #667eea; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #5568d3; }
        .admin-note { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Exclusive Event Package</h2>
          <p>Hi ${client.firstName},</p>
          <p>You've been invited to review an exclusive Curated One Experience designed specifically for you:</p>
          
          <div class="coe-details">
            <h3 style="margin-top: 0; color: #667eea;">${coe.name}</h3>
            <p>${coe.description}</p>
            <div class="detail-row">
              <span class="detail-label">Dates:</span> ${formatDateRange(coe.start_date, coe.end_date)}
            </div>
            <div class="detail-row">
              <span class="detail-label">Events:</span> ${coe.events ? coe.events.length : 0} exclusive events
            </div>
            <div class="price">Total: $${formatCurrency(coe.total_amount || 0)}</div>
          </div>
          
          ${adminNote ? `<div class="admin-note"><strong>Note from your event manager:</strong><br>${adminNote}</div>` : ''}
          
          <p style="text-align: center;">
            <a href="${coeUrl}" class="button">View Package Details</a>
          </p>
          
          <p>This exclusive package has been curated to provide you with an unforgettable experience. Please review the details and let us know if you have any questions.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: client.email,
    subject: `Exclusive Event Package: ${coe.name}`,
    html
  });
}

/**
 * Send booking confirmation email
 * @param {Object} user - User who made the booking
 * @param {Object} event - Event details
 * @param {Object} seat - Seat/table details
 * @returns {Promise<Object>} Send result
 */
async function sendBookingConfirmationEmail(user, event, seat) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .content h2 { color: #2c3e50; margin-top: 0; }
        .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #27ae60; }
        .detail-row { margin: 10px 0; }
        .detail-label { font-weight: bold; color: #666; }
        .success-badge { background: #27ae60; color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; margin: 10px 0; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Booking Confirmed!</h2>
          <p>Hi ${user.firstName},</p>
          <p><span class="success-badge">✓ Confirmed</span></p>
          <p>Your booking has been confirmed. We're excited to host you!</p>
          
          <div class="booking-details">
            <h3 style="margin-top: 0; color: #2c3e50;">${event.name}</h3>
            <div class="detail-row">
              <span class="detail-label">Date:</span> ${formatDate(event.start_datetime)}
            </div>
            <div class="detail-row">
              <span class="detail-label">Location:</span> ${event.location_id ? event.location_id.name : 'TBD'}
            </div>
            <div class="detail-row">
              <span class="detail-label">Table:</span> ${seat.code}
            </div>
            <div class="detail-row">
              <span class="detail-label">Capacity:</span> ${seat.capacity} people
            </div>
          </div>
          
          <p>Please arrive 15 minutes before the event starts. If you have any questions or need to make changes, please contact us.</p>
          <p><strong>We look forward to seeing you there!</strong></p>
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
    subject: `Booking Confirmed: ${event.name}`,
    html
  });
}

/**
 * Send admin notification email
 * @param {string} adminEmail - Admin email address
 * @param {string} subject - Notification subject
 * @param {string} message - Notification message
 * @returns {Promise<Object>} Send result
 */
async function sendAdminNotificationEmail(adminEmail, subject, message) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .notification { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3498db; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
        .timestamp { color: #999; font-size: 12px; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Admin Notification</h1>
        </div>
        <div class="content">
          <h2 style="color: #2c3e50; margin-top: 0;">${subject}</h2>
          <div class="notification">
            <p>${message}</p>
            <p class="timestamp">Timestamp: ${new Date().toLocaleString()}</p>
          </div>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform - Admin System
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `[Admin] ${subject}`,
    html
  });
}

/**
 * UTILITY FUNCTIONS
 */

/**
 * Strip HTML tags for plain text fallback
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Format date for email display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return 'Date TBD';
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format date range for email display
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {string} Formatted date range string
 */
function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Dates TBD';
  const start = new Date(startDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const end = new Date(endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  return `${start} - ${end}`;
}

/**
 * Format currency for email display
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * EXPORTS
 */
module.exports = {
  // Core function (use for any custom email)
  sendEmail,
  
  // Template functions (pre-built emails)
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendCOEInvitationEmail,
  sendBookingConfirmationEmail,
  sendAdminNotificationEmail,
  
  // Utility functions (exported for testing)
  formatDate,
  formatDateRange,
  formatCurrency
};

