const express = require('express');
const mongoose = require('mongoose');
const app = express();
require('dotenv').config();


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

let port = process.env.PORT || 80;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port} `);
});

module.exports = app;

