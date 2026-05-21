/**
 * Email Service
 * Centralized service for sending all types of emails via AWS SES
 * @description Provides reusable email functions with branded templates (Figma-aligned dark card)
 */

const AWS = require('aws-sdk');
const {
  renderEmailDocument,
  renderPrimaryCta,
  renderBulletList,
  renderCodeBox,
  renderBoldLine,
  renderMutedParagraph,
  renderFinePrint,
  renderDetailPanel,
  renderSpacer,
  renderAdminNotePanel,
  renderStatusBadge,
  getWelcomeDashboardUrl,
  escapeHtml,
} = require('./emailTemplates');

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
 * @param {string} [options.text] - Plain text content (optional)
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
    console.log('[EMAIL_SUCCESS]', {
      to,
      subject,
      messageId: result.MessageId,
      from: params.Source,
      timestamp: new Date().toISOString()
    });
    return { messageId: result.MessageId };
  } catch (error) {
    console.error('[EMAIL_ERROR]', {
      to,
      subject,
      from: process.env.FROM_EMAIL || 'noreply@the1.vip',
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

/**
 * Send email verification email
 * @param {Object} user - User object with email, firstName
 * @param {string} code - Verification code (6-digit numeric string)
 * @returns {Promise<Object>} Send result
 */
async function sendVerificationEmail(user, code) {
  const first = escapeHtml(user.firstName || 'there');
  const bodyHtml = [
    renderBoldLine(`Hi ${first},`),
    renderMutedParagraph('Thank you for signing up for The 1. Please verify your email address using the code below:'),
    renderCodeBox(code),
    renderMutedParagraph('Enter this code in the mobile app to activate your account.'),
    renderFinePrint('This code expires in 30 minutes.'),
    renderFinePrint("If you didn't create an account, please ignore this email."),
  ].join('');

  const html = renderEmailDocument({
    preheader: `Your The 1 verification code: ${code}`,
    bodyHtml,
  });

  const text = [
    'Verify your email — The 1',
    '',
    `Hi ${user.firstName || 'there'},`,
    '',
    `Your verification code: ${code}`,
    '',
    'Enter this code in the mobile app to activate your account.',
    'This code expires in 30 minutes.',
    "If you didn't create an account, ignore this email.",
  ].join('\n');

  return sendEmail({
    to: user.email,
    subject: 'Verify Your Email — The 1',
    html,
    text,
  });
}

/**
 * Send password reset email
 * @param {Object} user - User object
 * @param {string} code - Reset code (6-digit numeric string)
 * @returns {Promise<Object>} Send result
 */
async function sendPasswordResetEmail(user, code) {
  const first = escapeHtml(user.firstName || 'there');
  const bodyHtml = [
    renderBoldLine(`Hi ${first},`),
    renderMutedParagraph('We received a request to reset your password. Use the code below to create a new password:'),
    renderCodeBox(code),
    renderMutedParagraph('Enter this code in the mobile app to reset your password.'),
    renderFinePrint('This code expires in 30 minutes.'),
    renderFinePrint("If you didn't request this password reset, please ignore this email. Your password will remain unchanged."),
  ].join('');

  const html = renderEmailDocument({
    preheader: 'Password reset code for your The 1 account',
    bodyHtml,
  });

  const text = [
    'Password reset — The 1',
    '',
    `Hi ${user.firstName || 'there'},`,
    '',
    `Your reset code: ${code}`,
    '',
    'Enter this code in the mobile app to reset your password.',
    'This code expires in 30 minutes.',
    "If you didn't request this reset, ignore this email.",
  ].join('\n');

  return sendEmail({
    to: user.email,
    subject: 'Password Reset — The 1',
    html,
    text,
  });
}

/**
 * Send sign-in OTP email (passwordless login)
 * @param {Object} user - User with email, firstName
 * @param {string} code - 6-digit code
 * @returns {Promise<Object>} Send result
 */
async function sendLoginOtpEmail(user, code) {
  const first = escapeHtml(user.firstName || 'there');
  const bodyHtml = [
    renderBoldLine(`Hi ${first},`),
    renderMutedParagraph('Use this code to sign in to The 1. It is valid for 15 minutes.'),
    renderCodeBox(code),
    renderFinePrint('If you did not request this code, you can ignore this email.'),
  ].join('');

  const html = renderEmailDocument({
    preheader: `Your The 1 sign-in code: ${code}`,
    bodyHtml,
  });

  const text = [
    'Your The 1 sign-in code',
    '',
    `Hi ${user.firstName || 'there'},`,
    '',
    `Code: ${code}`,
    '',
    'Valid for 15 minutes.',
    'If you did not request this code, ignore this email.',
  ].join('\n');

  return sendEmail({
    to: user.email,
    subject: 'Your The 1 sign-in code',
    html,
    text,
  });
}

/**
 * Send welcome email after verification
 * @param {Object} user - User object
 * @returns {Promise<Object>} Send result
 */
async function sendWelcomeEmail(user) {
  const dashboardUrl = getWelcomeDashboardUrl();
  const first = escapeHtml(user.firstName || 'there');
  const bullets = [
    'Browse exclusive events',
    'Book premium tables and experiences',
    'Manage your bookings and profile',
    'Receive personalised event recommendations',
  ];

  const bodyHtml = [
    renderBoldLine(`${first}, welcome to The 1,`),
    renderMutedParagraph(
      `${escapeHtml('Your email has been verified successfully.')}<br/><br/>${escapeHtml("You're all set to start exploring premium events and exclusive experiences!")}`,
      { rawHtml: true }
    ),
    renderSpacer(32),
    renderBoldLine('Now you can:'),
    renderBulletList(bullets),
    renderPrimaryCta({ href: dashboardUrl, label: 'Go to Dashboard' }),
  ].join('');

  const html = renderEmailDocument({
    preheader: 'Welcome to The 1 — your email is verified',
    bodyHtml,
  });

  const text = [
    'Welcome to The 1',
    '',
    `${user.firstName || 'there'}, welcome to The 1,`,
    '',
    'Your email has been verified successfully.',
    "You're all set to start exploring premium events and exclusive experiences!",
    '',
    'Now you can:',
    ...bullets.map((b) => `• ${b}`),
    '',
    `Go to Dashboard: ${dashboardUrl}`,
  ].join('\n');

  return sendEmail({
    to: user.email,
    subject: 'Welcome to The 1',
    html,
    text,
  });
}

/**
 * Welcome email for a client account created by an admin (live + verified; app download CTAs).
 * @param {Object} user - User document
 * @returns {Promise<Object>} Send result
 */
async function sendAdminCreatedClientWelcomeEmail(user) {
  const first = escapeHtml(user.firstName || 'there');
  const iosUrl = (process.env.MOBILE_APP_IOS_URL || '').trim();
  const androidUrl = (process.env.MOBILE_APP_ANDROID_URL || '').trim();

  const introHtml = [
    escapeHtml(
      'Your The 1 account has been created for you. Open the mobile app and sign in using ',
    ),
    `<strong>${escapeHtml('email sign-in code')}</strong>`,
    escapeHtml(' with this email address, or use '),
    `<strong>${escapeHtml('Forgot password')}</strong>`,
    escapeHtml(' on the sign-in screen to set a password.'),
  ].join('');

  const parts = [
    renderBoldLine(`Hi ${first},`),
    renderMutedParagraph(introHtml, {rawHtml: true}),
    renderSpacer(24),
    renderBoldLine('Get the app'),
  ];

  if (iosUrl) {
    parts.push(renderPrimaryCta({href: iosUrl, label: 'Download for iOS'}));
  }
  if (androidUrl) {
    parts.push(renderPrimaryCta({href: androidUrl, label: 'Download for Android'}));
  }
  if (!iosUrl && !androidUrl) {
    parts.push(renderMutedParagraph('App store links will be added soon.'));
  }

  const bodyHtml = parts.join('');

  const textLines = [
    'Your The 1 account',
    '',
    `Hi ${user.firstName || 'there'},`,
    '',
    'Your account has been created. Open the mobile app and sign in using the email sign-in code with this address, or use Forgot password to set a password.',
    '',
    'Get the app:',
  ];
  if (iosUrl) {
    textLines.push(`iOS: ${iosUrl}`);
  }
  if (androidUrl) {
    textLines.push(`Android: ${androidUrl}`);
  }
  if (!iosUrl && !androidUrl) {
    textLines.push('Store links will be added soon.');
  }

  const html = renderEmailDocument({
    preheader: 'Your The 1 account is ready — download the app',
    bodyHtml,
  });

  return sendEmail({
    to: user.email,
    subject: 'Your The 1 account is ready',
    html,
    text: textLines.join('\n'),
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
  const first = escapeHtml(client.firstName || 'there');
  const coeName = escapeHtml(coe.name || 'Exclusive package');
  const coeDesc = escapeHtml(coe.description || '');
  const eventsCount = coe.events ? coe.events.length : 0;
  const totalFormatted = formatCurrency(coe.total_amount || 0);

  const detailsInner = `
    <p style="margin:0 0 12px 0;font-weight:bold;color:#B4C1EA;font-size:15px;">${coeName}</p>
    <p style="margin:0 0 16px 0;">${coeDesc}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Dates:</strong> ${escapeHtml(formatDateRange(coe.start_date, coe.end_date))}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Events:</strong> ${eventsCount} exclusive events</p>
    <p style="margin:16px 0 0 0;font-size:18px;font-weight:bold;color:#ffffff;">Total: $${totalFormatted}</p>
  `;

  const bodyHtml = [
    renderBoldLine(`Hi ${first},`),
    renderMutedParagraph("You've been invited to review an exclusive Curated One Experience designed specifically for you:"),
    renderDetailPanel(detailsInner),
    adminNote ? renderAdminNotePanel(adminNote) : '',
    renderPrimaryCta({ href: coeUrl, label: 'View Package Details' }),
    renderMutedParagraph('This exclusive package has been curated to provide you with an unforgettable experience. Please review the details and let us know if you have any questions.'),
  ].join('');

  const html = renderEmailDocument({
    preheader: `Exclusive package: ${coe.name || 'The 1'}`,
    bodyHtml,
  });

  const text = [
    `Exclusive Event Package: ${coe.name}`,
    '',
    `Hi ${client.firstName || 'there'},`,
    '',
    `Package: ${coe.name}`,
    `${coe.description || ''}`,
    `Dates: ${formatDateRange(coe.start_date, coe.end_date)}`,
    `Events: ${eventsCount}`,
    `Total: $${totalFormatted}`,
    '',
    adminNote ? `Note: ${adminNote}\n` : '',
    `Open: ${coeUrl}`,
  ].join('\n');

  return sendEmail({
    to: client.email,
    subject: `Exclusive Event Package: ${coe.name}`,
    html,
    text,
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
  const first = escapeHtml(user.firstName || 'there');
  const eventName = escapeHtml(event.name || 'Event');
  const locName = event.location_id && event.location_id.name ? escapeHtml(event.location_id.name) : 'TBD';
  const seatCode = escapeHtml(seat.code || '');
  const cap = seat.capacity != null ? escapeHtml(String(seat.capacity)) : '';

  const detailsInner = `
    <p style="margin:0 0 12px 0;font-weight:bold;color:#B4C1EA;font-size:15px;">${eventName}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Date:</strong> ${escapeHtml(formatDate(event.start_datetime))}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Location:</strong> ${locName}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Table:</strong> ${seatCode}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Capacity:</strong> ${cap} people</p>
  `;

  const bodyHtml = [
    renderBoldLine(`Hi ${first},`),
    renderStatusBadge('Confirmed'),
    renderMutedParagraph("Your booking has been confirmed. We're excited to host you!"),
    renderDetailPanel(detailsInner),
    renderMutedParagraph('Please arrive 15 minutes before the event starts. If you have any questions or need to make changes, please contact us.'),
    renderBoldLine('We look forward to seeing you there!'),
  ].join('');

  const html = renderEmailDocument({
    preheader: `Booking confirmed: ${event.name}`,
    bodyHtml,
  });

  const text = [
    `Booking Confirmed: ${event.name}`,
    '',
    `Hi ${user.firstName || 'there'},`,
    '',
    'Status: Confirmed',
    '',
    `${event.name}`,
    `Date: ${formatDate(event.start_datetime)}`,
    `Location: ${event.location_id ? event.location_id.name : 'TBD'}`,
    `Table: ${seat.code}`,
    `Capacity: ${seat.capacity} people`,
  ].join('\n');

  return sendEmail({
    to: user.email,
    subject: `Booking Confirmed: ${event.name}`,
    html,
    text,
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
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message);

  const bodyHtml = [
    renderBoldLine('Admin notification'),
    renderMutedParagraph(`<strong style="color:#ffffff;font-weight:bold;">${safeSubject}</strong>`, { rawHtml: true }),
    renderDetailPanel(`<p style="margin:0;white-space:pre-wrap;">${safeMessage}</p>`),
    renderMutedParagraph(`Timestamp: ${escapeHtml(new Date().toLocaleString())}`, { rawHtml: true }),
  ].join('');

  const html = renderEmailDocument({
    preheader: subject,
    bodyHtml,
    footerNote: 'Internal message — The 1 admin system.',
    brandName: 'The 1',
  });

  const text = [`[Admin] ${subject}`, '', message, '', `Timestamp: ${new Date().toLocaleString()}`].join('\n');

  return sendEmail({
    to: adminEmail,
    subject: `[Admin] ${subject}`,
    html,
    text,
  });
}

/**
 * Send newsletter subscription email to CONTACT_EMAIL recipient
 * @param {string} email - Subscriber email address
 * @returns {Promise<Object|void>} Send result or void if CONTACT_EMAIL not configured
 */
async function sendNewsletterSubscriptionEmail(email) {
  const recipient = process.env.CONTACT_EMAIL;

  if (!recipient) {
    console.warn('[EMAIL_NEWSLETTER] CONTACT_EMAIL is not configured, skipping newsletter subscription email send', {
      timestamp: new Date().toISOString()
    });
    return;
  }

  const emailSubject = '[THE1 Website Newsletter Subscription] New Subscriber';

  console.log('[EMAIL_NEWSLETTER] Preparing to send newsletter subscription email', {
    to: recipient,
    from: process.env.FROM_EMAIL || 'noreply@the1.vip',
    subject: emailSubject,
    subscriberEmail: email,
    timestamp: new Date().toISOString()
  });

  const safeEmail = escapeHtml(email);
  const rowsInner = `
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Subscriber email:</strong> ${safeEmail}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Subscription date:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Source:</strong> THE1 Website (website2)</p>
  `;

  const bodyHtml = [
    renderBoldLine('Newsletter subscription'),
    renderMutedParagraph('A new subscriber has signed up for the newsletter.'),
    renderDetailPanel(rowsInner),
    renderFinePrint('This is a newsletter subscription notification, not a contact form submission.'),
  ].join('');

  const html = renderEmailDocument({
    preheader: `New newsletter subscriber: ${email}`,
    bodyHtml,
    footerNote: 'THE1 Website — internal notification.',
  });

  const text = [
    'Newsletter subscription',
    '',
    `Subscriber: ${email}`,
    `Date: ${new Date().toLocaleString()}`,
    'Source: THE1 Website (website2)',
  ].join('\n');

  const result = await sendEmail({
    to: recipient,
    subject: emailSubject,
    html,
    text,
  });

  console.log('[EMAIL_NEWSLETTER] Newsletter subscription email sent via SES', {
    to: recipient,
    subject: emailSubject,
    subscriberEmail: email,
    messageId: result && result.messageId,
    timestamp: new Date().toISOString()
  });

  return result;
}

/**
 * Send website contact form submission email to CONTACT_EMAIL recipient
 * @param {Object} data - Contact form data
 * @param {string} data.name - Sender name
 * @param {string} data.email - Sender email
 * @param {string} [data.phone] - Sender phone
 * @param {string} data.subject - Subject from the form
 * @param {string} data.message - Message body
 * @returns {Promise<Object|void>} Send result or void if CONTACT_EMAIL not configured
 */
async function sendContactFormEmail(data) {
  const recipient = process.env.CONTACT_EMAIL;

  if (!recipient) {
    console.warn('[EMAIL_CONTACT] CONTACT_EMAIL is not configured, skipping contact form email send', {
      timestamp: new Date().toISOString()
    });
    return;
  }

  const { name, email, phone, subject, message } = data;
  const safeMessage = message || '';

  const emailSubject = `[THE1 Website Contact] ${subject}`;

  console.log('[EMAIL_CONTACT] Preparing to send contact form email', {
    to: recipient,
    from: process.env.FROM_EMAIL || 'noreply@the1.vip',
    subject: emailSubject,
    hasName: !!name,
    hasEmail: !!email,
    hasPhone: !!phone,
    timestamp: new Date().toISOString()
  });

  const inner = `
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Name:</strong> ${escapeHtml(name || '')}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Email:</strong> ${escapeHtml(email || '')}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Phone:</strong> ${escapeHtml(phone || 'N/A')}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Submitted at:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
    <p style="margin:16px 0 0 0;"><strong style="color:#ffffff;font-weight:bold;">Message:</strong></p>
    <p style="margin:8px 0 0 0;white-space:pre-wrap;">${escapeHtml(safeMessage)}</p>
  `;

  const bodyHtml = [
    renderBoldLine('New contact form submission'),
    renderMutedParagraph(`Subject: ${escapeHtml(subject || '')}`, { rawHtml: true }),
    renderDetailPanel(inner),
  ].join('');

  const html = renderEmailDocument({
    preheader: `Contact: ${subject}`,
    bodyHtml,
    footerNote: 'THE1 Website — internal notification.',
  });

  const text = [
    'Contact form',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone || 'N/A'}`,
    `Subject: ${subject}`,
    `Submitted: ${new Date().toLocaleString()}`,
    '',
    safeMessage,
  ].join('\n');

  const result = await sendEmail({
    to: recipient,
    subject: emailSubject,
    html,
    text,
  });

  console.log('[EMAIL_CONTACT] Contact form email sent via SES', {
    to: recipient,
    subject: emailSubject,
    messageId: result && result.messageId,
    timestamp: new Date().toISOString()
  });

  return result;
}

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

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendLoginOtpEmail,
  sendWelcomeEmail,
  sendAdminCreatedClientWelcomeEmail,
  sendCOEInvitationEmail,
  sendBookingConfirmationEmail,
  sendAdminNotificationEmail,
  sendContactFormEmail,
  sendNewsletterSubscriptionEmail,
  formatDate,
  formatDateRange,
  formatCurrency
};
