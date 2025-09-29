// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
});

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
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
      mediaSrc: ["'self'", "https://*.s3.*.amazonaws.com", "https://*.s3.amazonaws.com"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = 80;
let dbStatus = 'not connected';

// Try to connect to DB on startup
mongoose.connect(process.env.DB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    dbStatus = 'connected';
    console.log('✅ Connected to MongoDB');
  })
  .catch((err) => {
    dbStatus = 'connection failed';
    console.error('❌ Failed to connect to MongoDB:', err.message);
  });

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const testRoutes = require('./routes/test');

// API Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/users', userRoutes);
app.use('/v1/locations', locationRoutes);

// Test Interface Routes
app.use('/test', testRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log(`Server is up ${process.env.NODE_ENV}`);
  res.send(`✅ ${process.env.NODE_ENV} DB_URI is present`);
   
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
    output += `❌ DATABASE: DB_URI is missing\n`;
  } else {
    const isProd = dbUri.toLowerCase().includes('prod');
    const dbStatusIcon = dbStatus === 'connected' ? '✅' : '❌';
    output += `${dbStatusIcon} DATABASE: ${isProd ? 'PROD' : 'STAGE'} - ${dbStatus === 'connected' ? 'Connected' : 'Failed'}\n`;
  }

  // 2. S3 Bucket Check
  const s3Bucket = process.env.S3_BUCKET;
  if (!s3Bucket) {
    output += `❌ S3 BUCKET: S3_BUCKET is missing\n`;
  } else {
    try {
      const s3 = new AWS.S3({
        region: process.env.AWS_REGION || 'us-west-2'
      });

      await s3.headBucket({ Bucket: s3Bucket }).promise();
      output += `✅ S3 BUCKET: ${s3Bucket} - Accessible\n`;
    } catch (s3Error) {
      output += `❌ S3 BUCKET: ${s3Bucket} - ${s3Error.message}\n`;
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