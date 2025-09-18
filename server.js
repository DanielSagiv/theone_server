const express = require('express');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 80;

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('THEONE SERVER xxxx');
});

app.get('/health', (req, res) => {
  res.send('healthy xxxx');
});

// Start server
/*app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});*/
app.listen(80, '0.0.0.0', () => {
  console.log('Server is running on port 80 prod service test');
});

module.exports = app;
//