require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const methodOverride = require('method-override');

const { validateEnvironment } = require('./src/config/env');
const connectDatabase = require('./src/config/database');
const { attachLocals, flashMiddleware, csrfMiddleware } = require('./src/middleware/common');
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const cartRoutes = require('./src/routes/cart');
const checkoutRoutes = require('./src/routes/checkout');
const userRoutes = require('./src/routes/user');
const accountFeatureRoutes = require('./src/routes/accountFeatures');
const adminRoutes = require('./src/routes/admin');
const adminFeatureRoutes = require('./src/routes/adminFeatures');
const webhookRoutes = require('./src/routes/webhook');
const internalRoutes = require('./src/routes/internal');
const { startScheduler } = require('./src/jobs/scheduler');

const config = validateEnvironment();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(compression());
if (!config.isProduction) app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && req.body._method) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
  return req.query?._method;
}));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: config.isProduction ? '1h' : 0,
  etag: true,
  immutable: false
}));

app.get(['/health', '/health/live'], (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, service: 'TokoZyphra', status: 'live', timestamp: new Date().toISOString() });
});

app.use(async (req, res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.get('/health/ready', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, service: 'TokoZyphra', status: 'ready', timestamp: new Date().toISOString() });
});

app.use('/webhooks', webhookRoutes);
app.use('/internal', internalRoutes);

app.use(session({
  name: 'tz.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: config.sessionTtlSeconds,
    autoRemove: 'native',
    touchAfter: 24 * 60 * 60
  }),
  cookie: {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: config.sessionTtlSeconds * 1000,
    path: '/'
  }
}));

app.use(flashMiddleware);
app.use(attachLocals);
app.use(csrfMiddleware);

app.use('/', publicRoutes);
app.use('/auth', authRoutes);
app.use('/cart', cartRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/account', userRoutes);
app.use('/account', accountFeatureRoutes);
app.use('/admin', adminRoutes);
app.use('/admin', adminFeatureRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Halaman Tidak Ditemukan',
    status: 404,
    message: 'Halaman yang Anda cari tidak tersedia.'
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);

  let status = Number.isInteger(error.status) ? error.status : 500;
  let message = error.message || 'Terjadi kesalahan pada server.';
  if (error.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'Ukuran file produk digital melebihi batas yang diizinkan.';
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400;
    message = 'File produk digital yang dikirim tidak valid.';
  }
  if (error.name === 'CastError' || error.name === 'ValidationError') status = 400;
  if (error.code === 11000) {
    status = 409;
    message = 'Data dengan nilai unik tersebut sudah digunakan.';
  }
  if (config.isProduction && status >= 500) message = 'Terjadi kesalahan pada server. Silakan coba kembali.';

  if (req.path.startsWith('/webhooks/') || req.path.startsWith('/internal/')) {
    return res.status(status).json({ ok: false, message });
  }
  res.status(status).render('error', {
    title: status >= 500 ? 'Terjadi Kesalahan' : 'Permintaan Gagal',
    status,
    message
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`TokoZyphra berjalan di http://localhost:${config.port}`);
  });
  if (config.enableInternalJobs) startScheduler(config.internalJobIntervalMinutes);
}

module.exports = app;
