// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error(' Unhandled Rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error(' Uncaught Exception:', err);
});

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const path = require('path');
const app = express();
const AWS = require('aws-sdk');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "https://*.s3.*.amazonaws.com", "https://*.s3.amazonaws.com"],
      connectSrc: ["'self'", "https://*.s3.*.amazonaws.com", "https://*.s3.amazonaws.com"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https://*.s3.*.amazonaws.com", "https://*.s3.amazonaws.com", "https://the1-media-uploads-stage.s3.us-west-2.amazonaws.com"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.CORS_ORIGIN || 'http://localhost:3000')
    : true, // Allow all origins in development (for mobile app testing)
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/website/assets', express.static(path.join(__dirname, 'website/assets')));
app.use('/website2/assets', express.static(path.join(__dirname, 'website2/assets')));

// Trust reverse proxy headers (ALB/NGINX) so secure session cookies work on AWS.
app.set('trust proxy', 1);

// Session middleware for password protection
app.use(session({
  secret: process.env.SESSION_SECRET || 'the1-platform-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

const PORT = 80;
let dbStatus = 'not connected';

// Try to connect to DB on startup
mongoose.connect(process.env.DB_URI)
  .then(() => {
    dbStatus = 'connected';
    console.log(' Connected to MongoDB');
    
    // Start automated billing cron jobs (Phase 3: Recurring Billing)
    const cronJobs = require('./utils/cronJobs');
    cronJobs.startAllCronJobs();
    
    // Initialize Firebase Admin for push notifications
    const notificationService = require('./services/notificationService');
    notificationService.initializeFirebase();
    notificationService.initializeExpo();
  })
  .catch((err) => {
    dbStatus = 'connection failed';
    console.error(' Failed to connect to MongoDB:', err.message);
  });

// Import middleware
const { requirePasswordAuth } = require('./middleware/passwordProtection');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const eventRoutes = require('./routes/events');
const coeRoutes = require('./routes/coes');
const testRoutes = require('./routes/test');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const subscriptionRoutes = require('./routes/subscriptions');
const gxnRoutes = require('./routes/gxn');
const taoGroupRoutes = require('./routes/taoGroup');
const botRoutes = require('./routes/bot');
const websiteRoutes = require('./routes/website');
const website2Routes = require('./routes/website2');
const featuresRoutes = require('./routes/features');
const notificationRoutes = require('./routes/notifications');
const messagingRoutes = require('./routes/messaging');
const adminToolsRoutes = require('./routes/adminTools');
const jointEventsRoutes = require('./routes/jointEvents');
const clientLogsRoutes = require('./routes/clientLogs');

// API Routes
app.use('/v1/auth', authRoutes);
console.log('[AUTH_ROUTES] OTP login endpoints active:', {
  requestCode: 'POST /v1/auth/login/request-code',
  verifyCode: 'POST /v1/auth/login/verify-code',
});
app.use('/v1/users', userRoutes);
app.use('/v1/locations', locationRoutes);
app.use('/v1/events', eventRoutes);
app.use('/v1/coes', coeRoutes);
app.use('/v1/payments', paymentRoutes);
app.use('/v1/subscriptions', subscriptionRoutes);
app.use('/v1/gxn', gxnRoutes);
app.use('/v1/tao', taoGroupRoutes);
app.use('/v1/bot', botRoutes);
app.use('/v1/features', featuresRoutes);
app.use('/v1/client-logs', clientLogsRoutes);
app.use('/v1/notifications', notificationRoutes);
app.use('/v1/messaging', messagingRoutes);
app.use('/v1/admin/tools', adminToolsRoutes);
app.use('/v1/admin', jointEventsRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/website', websiteRoutes);
app.use('/website2', website2Routes);

// Landing page route (password protection)
app.get('/', requirePasswordAuth);
app.post('/', requirePasswordAuth);

// Logout route to clear password session
app.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
    });
  }
  res.redirect('/');
});

// Test Interface Routes (protected by password)
app.use('/test', requirePasswordAuth, testRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log(`Server is up ${process.env.NODE_ENV}`);
  res.send(` ${process.env.NODE_ENV} DB_URI is present`);
   
});

//  check list
app.get('/checklist', async (req, res) => {
  let output = `\n🔍 THEONE SERVER CHECKLIST\n`;
  output += `================================\n`;
  output += `Environment: ${process.env.NODE_ENV || 'unknown'}\n`;
  output += `Timestamp: ${new Date().toLocaleString()}\n\n`;

  // 1. Database Check (assume dbStatus already set elsewhere)
  const dbUri = process.env.DB_URI;
  if (!dbUri) {
    output += ` DATABASE: DB_URI is missing\n`;
  } else {
    const isProd = dbUri.toLowerCase().includes('prod');
    const dbStatusIcon = dbStatus === 'connected' ? 'V' : 'X';
    output += `${dbStatusIcon} DATABASE: ${isProd ? 'PROD' : 'STAGE'} - ${dbStatus === 'connected' ? 'Connected' : 'Failed'}\n`;
  }

  // 2. S3 Bucket Check
  const s3Bucket = process.env.S3_BUCKET;
  if (!s3Bucket) {
    output += `S3 BUCKET: S3_BUCKET is missing\n`;
  } else {
    try {
      const s3 = new AWS.S3({
        region: process.env.AWS_REGION || 'us-west-2'
      });

      await s3.headBucket({ Bucket: s3Bucket }).promise();
      output += ` S3 BUCKET: ${s3Bucket} - Accessible\n`;
    } catch (s3Error) {
      output += ` S3 BUCKET: ${s3Bucket} - ${s3Error.message}\n`;
    }
  }

  // 3. Environment Info
  output += `\n📋 ENVIRONMENT INFO:\n`;
  output += `   Node Env: ${process.env.NODE_ENV}\n`;
  output += `   Port: ${process.env.PORT || 80}\n`;
  output += `   AWS Region: ${process.env.AWS_REGION || 'us-west-2'}\n`;
  output += `   Has DB URI: ${!!process.env.DB_URI ? 'Yes' : 'No'}\n`;
  output += `   Has S3 Bucket: ${!!process.env.S3_BUCKET ? 'Yes' : 'No'}\n`;

  output += `\n================================\n`;

  res.set('Content-Type', 'text/plain');
  res.send(output);
});
let port = process.env.PORT || 3006;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;