// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
});

const express = require('express');
const mongoose = require('mongoose');
const app = express();
const AWS = require('aws-sdk');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

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

// Health check endpoint
app.get('/health', (req, res) => {
  console.log(`Server is up ${process.env.NODE_ENV}`);
  res.send(`✅ ${process.env.NODE_ENV} DB_URI is present`);
   
});

//  check list
//  check list
app.get('/checklist', async (req, res) => {
  let output = `\n🔍 THEONE SERVER CHECKLIST\n`;
  output += `================================\n`;
  output += `Environment: ${process.env.NODE_ENV || 'unknown'}\n`;
  output += `Timestamp: ${new Date().toLocaleString()}\n\n`;

  // 1. Database Check
  const dbUri = process.env.DB_URI;
  if (!dbUri) {
    output += `❌ DATABASE: DB_URI is missing\n`;
  } else {
    const isProd = dbUri.includes('prod') || dbUri.includes('PROD');
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
        // No credentials - AWS SDK will automatically use:
        // - IAM role (when running on ECS)
        // - Local credentials (when running locally)
      });
      
      await s3.headBucket({ Bucket: s3Bucket }).promise();
      output += `✅ S3 BUCKET: ${s3Bucket} - Accessible\n`;
    } catch (s3Error) {
      output += `❌ S3 BUCKET: ${s3Bucket} - ${s3Error.message}\n`;
    }
  }

  // 3. AWS Credentials Check
  try {
    const sts = new AWS.STS({
      region: process.env.AWS_REGION || 'us-west-2'
      // No credentials - AWS SDK will automatically use:
      // - IAM role (when running on ECS)
      // - Local credentials (when running locally)
    });
    
    const identity = await sts.getCallerIdentity().promise();
    output += `✅ AWS CREDENTIALS: Account ${identity.Account}\n`;
  } catch (awsError) {
    output += `❌ AWS CREDENTIALS: ${awsError.message}\n`;
  }

  // 4. Environment Info
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