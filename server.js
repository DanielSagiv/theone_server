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
app.get('/checklist', (req, res) => {
  const dbUri = process.env.DB_URI;
  console.log("DB_URI:", dbUri?.slice(0, 15) + '...');  

  if (!dbUri) {
    res.status(500).send('❌ DB_URI is missing');
  } else {
    if (dbUri.includes('prod') || dbUri.includes('PROD')) {
      res.send('✅ PROD DB_URI is present');
    } else {
      res.send('✅ stage DB_URI is present');
    }
  }
});

let port = process.env.PORT || 3009;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
