'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const { open } = require('./db');
const { seedDemo } = require('./seed');
const { createSecurity } = require('./lib/security');
const { createProducts } = require('./lib/products');
const { createOrders } = require('./lib/orders');
const { watchSvg } = require('./lib/placeholder');
const format = require('./lib/format');
const shopRoutes = require('./routes/shop');
const cartRoutes = require('./routes/cart');
const adminRoutes = require('./routes/admin');

function createApp(config) {
  const db = open(config.dbFile);
  if (config.seedDemo) seedDemo(db);
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const security = createSecurity(config);
  const products = createProducts(db);
  const orders = createOrders(db, config);
  const money = format.createMoneyFormatter(config.currency);
  const dateTime = format.createDateFormatter(config.timezone);
  const ctx = { config, db, products, orders, security, money };

  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(security.headers);

  // Статика: до сессии, чтобы не выдавать cookie на каждый файл
  const staticOpts = { maxAge: config.isProd ? '7d' : 0 };
  app.use(express.static(path.join(__dirname, '..', 'public'), staticOpts));
  app.use('/uploads', express.static(config.uploadsDir, { ...staticOpts, index: false, dotfiles: 'ignore' }));

  app.get('/img/p/:slug.svg', (req, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(watchSvg(req.params.slug));
  });
  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

  app.use(security.session);

  // Общие данные для всех шаблонов
  const applyLocals = (req, res) => {
    Object.assign(res.locals, {
      shop: config.shop,
      siteUrl: config.siteUrl,
      money,
      dateTime,
      currency: config.currency,
      cartCount: orders.resolveCart(req.cart).count,
      path: req.path,
      isAdmin: Boolean(req.isAdmin),
      csrfToken: req.csrfToken || '',
      fmt: format,
      productImage: (p) => (p.image ? `/uploads/${p.image}` : `/img/p/${p.slug}.svg`),
      meta: { title: config.shop.name, description: config.shop.slogan, canonical: null },
    });
  };
  app.use((req, res, next) => {
    applyLocals(req, res);
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(security.csrfProtect);

  app.use(shopRoutes(ctx));
  app.use(cartRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));

  app.use((req, res) => {
    if (!res.locals.shop) applyLocals(req, res);
    res.status(404).render('error', {
      title: 'Страница не найдена',
      message: 'Такой страницы нет. Возможно, товар уже снят с продажи.',
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    if (!res.locals.shop) applyLocals(req, res);
    res.status(500).render('error', {
      title: 'Что-то пошло не так',
      message: 'На сервере произошла ошибка. Попробуйте ещё раз чуть позже.',
    });
  });

  app.set('db', db); // нужен тестам и скриптам обслуживания
  app.locals.close = () => db.close();
  return app;
}

module.exports = { createApp };
