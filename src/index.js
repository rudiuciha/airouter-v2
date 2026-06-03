require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const morgan     = require('morgan');
const path       = require('path');

const { initData }      = require('./utils/storage');
const { authMiddleware }= require('./middleware/auth');
const authRoutes        = require('./routes/auth');
const apiRoutes         = require('./routes/api');
const proxyRoutes       = require('./routes/proxy');

const app  = express();
const PORT = process.env.PORT || 20130;
const HOST = process.env.HOST || '0.0.0.0';

initData();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit:'50mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(morgan('dev'));

// Static dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Auth (no JWT needed)
app.use('/auth', authRoutes);

// Dashboard API (JWT protected)
app.use('/api', authMiddleware, apiRoutes);

// OpenAI-compatible proxy (API key auth for /chat/completions, /embeddings)
app.use('/v1', proxyRoutes);

// Catch-all -> dashboard
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, HOST, () => {
  console.log(`\n  AIRouter v2.0`);
  console.log(`   Dashboard : http://localhost:${PORT}`);
  console.log(`   Proxy     : http://localhost:${PORT}/v1`);
  console.log(`   Health    : http://localhost:${PORT}/v1/health`);
  console.log(`   Password  : ${process.env.INITIAL_PASSWORD || 'admin123'}\n`);
});

module.exports = app;
