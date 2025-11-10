import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Debug environment variables
console.log('🔧 Environment variables:');
console.log('PORT:', PORT);

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 License key server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});
