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
app.get('/health', async (req, res) => {
  const uri = process.env.DB_URI;

  if (!uri) {
    return res.status(500).send('❌ DB_URI not set');
  }

  try {
    // Try connecting (with 3s timeout)
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });

    res.send('✅ Healthy: Connected to DB');
  } catch (err) {
    res.status(500).send(`❌ Healthy: Failed to connect to DB - ${err.message}`);
  } finally {
    // Clean up connection
    await mongoose.disconnect();
  }
});


app.listen(80, '0.0.0.0', () => {
  console.log('Server is running on port 80 prod service test');
});

module.exports = app;
