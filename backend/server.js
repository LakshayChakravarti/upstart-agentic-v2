require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { validateJwtSecret } = require('./middleware/auth');
const authRoutes = require('./routes/authRoutes');
const ideaRoutes = require('./routes/ideaRoutes');

// Validate production secrets safely at server startup
validateJwtSecret();

const app = express();
const PORT = process.env.PORT || 5000;

// Warn if FRONTEND_URL is not configured in production
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    console.warn('⚠️  [CORS] WARNING: FRONTEND_URL is not set in production. Defaulting to http://localhost:3000; cross-origin requests from remote frontends will be blocked.');
}

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', ideaRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// 120-second server-level timeout — ensures stalled Groq calls
// don't hold open connections past the frontend AbortController
const server = app.listen(PORT, () => {
    console.log(`🚀 Upstart API running on http://localhost:${PORT}`);
});
server.setTimeout(120000);

module.exports = app;
