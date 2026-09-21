const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const kitRoutes = require('./routes/kitRoutes');
const practiceRoutes = require('./routes/practiceRoutes');
const { requireAuth } = require('./middleware/auth');
const rateLimit = require('./middleware/rateLimit');

const app = express();
const parseClientOrigins = (value = process.env.CLIENT_ORIGIN || 'http://localhost:3001') => {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CLIENT_ORIGIN entries must use HTTP or HTTPS.');
    return parsed.origin;
  });
  if (!origins.length) throw new Error('CLIENT_ORIGIN must contain at least one frontend origin.');
  return [...new Set(origins)];
};
const configuredClientOrigins = parseClientOrigins();
// CRA uses port 3000 by default, while it switches to 3001 when that port is
// occupied. Accept both local development origins without loosening the
// configured production allow-list.
const clientOrigins = process.env.NODE_ENV === 'production'
  ? configuredClientOrigins
  : [...new Set([...configuredClientOrigins, 'http://localhost:3000', 'http://localhost:3001'])];
const corsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (health checks and server-to-server calls) do not need CORS.
    if (!origin || clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS policy.'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
};

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Interview kit API is running' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', rateLimit({ max: 120 }), authRoutes);
app.use('/api/kits', rateLimit({ windowMs: 60_000, max: 60 }), requireAuth, kitRoutes);
app.use('/api/kits', rateLimit({ windowMs: 60_000, max: 120 }), requireAuth, practiceRoutes);

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  }

  console.error('Unhandled request error:', error.message);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
});

module.exports = app;
module.exports.parseClientOrigins = parseClientOrigins;
