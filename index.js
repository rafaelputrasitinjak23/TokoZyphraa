require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const methodOverride = require('method-override');

const connectDatabase = require('./src/config/database');
const { attachLocals, flashMiddleware, csrfMiddleware } = require('./src/middleware/common');
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const cartRoutes = require('./src/routes/cart');
const checkoutRoutes = require('./src/routes/checkout');
const userRoutes = require('./src/routes/user');
const adminRoutes = require('./src/routes/admin');
const webhookRoutes = require('./src/routes/webhook');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET wajib diatur pada environment production.');
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
if (!isProduction) app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && req.body._method) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
  return req.query?._method;
}));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProduction ? '7d' : 0,
  etag: true
}));

const mongoUrl = process.env.MONGODB_URI;
if (!mongoUrl) {
  console.warn('MONGODB_URI belum diatur. Aplikasi akan gagal saat mengakses database.');
}

app.use(session({
  name: 'tz.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  store: mongoUrl ? MongoStore.create({
    mongoUrl,
    collectionName: 'sessions',
    ttl: 60 * 60 * 24 * 7,
    autoRemove: 'native'
  }) : undefined,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(async (req, res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.use(flashMiddleware);
app.use(attachLocals);
app.use('/webhooks', webhookRoutes);
app.use(csrfMiddleware);

app.use('/', publicRoutes);
app.use('/auth', authRoutes);
app.use('/cart', cartRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/account', userRoutes);
app.use('/admin', adminRoutes);

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
  const status = error.status || 500;
  res.status(status).render('error', {
    title: status === 500 ? 'Terjadi Kesalahan' : 'Permintaan Gagal',
    status,
    message: isProduction && status === 500
      ? 'Terjadi kesalahan pada server. Silakan coba kembali.'
      : error.message
  });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`TokoZyphra berjalan di http://localhost:${port}`);
  });
}

module.exports = app;
