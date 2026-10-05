'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

// Простая загрузка .env без внешних зависимостей
function loadEnvFile() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function load(overrides = {}) {
  loadEnvFile();
  const env = { ...process.env, ...overrides };

  const str = (name, fallback = '') =>
    env[name] === undefined || env[name] === '' ? fallback : env[name];

  const int = (name, fallback) => {
    const n = Number.parseInt(str(name), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const isProd = str('NODE_ENV') === 'production';
  const sessionSecret = str('SESSION_SECRET');
  const adminPassword = str('ADMIN_PASSWORD');

  if (isProd && sessionSecret.length < 32) {
    throw new Error('В боевом режиме задайте SESSION_SECRET длиной не менее 32 символов.');
  }
  if (isProd && adminPassword.length < 10) {
    throw new Error('В боевом режиме задайте ADMIN_PASSWORD длиной не менее 10 символов.');
  }

  const siteUrl = str('SITE_URL', 'http://localhost:3000').replace(/\/+$/, '');
  const dataDir = path.resolve(str('DATA_DIR', path.join(__dirname, '..', 'data')));

  return {
    isProd,
    port: int('PORT', 3000),
    siteUrl,
    // Cookie с флагом Secure браузер принимает только по HTTPS
    secureCookies: siteUrl.startsWith('https://'),
    dataDir,
    dbFile: str('DB_FILE', path.join(dataDir, 'shop.db')),
    uploadsDir: path.join(dataDir, 'uploads'),
    // В разработке секрет случайный на каждый запуск — сессии сбрасываются при перезапуске.
    sessionSecret: sessionSecret || crypto.randomBytes(32).toString('hex'),
    adminPassword: adminPassword || 'admin',
    // Демо-товары по умолчанию только на локальном компьютере, в боевом режиме — выключены
    seedDemo: str('SEED_DEMO', isProd ? 'false' : 'true') !== 'false',
    shop: {
      name: str('SHOP_NAME', 'Часовая лавка'),
      slogan: str('SHOP_SLOGAN', 'Часы, которые хочется носить'),
      phone: str('SHOP_PHONE'),
      email: str('SHOP_EMAIL'),
      address: str('SHOP_ADDRESS'),
      hours: str('SHOP_HOURS', 'Пн–Сб, 10:00–19:00'),
    },
    currency: str('CURRENCY', 'RUB'),
    // Суммы хранятся в минорных единицах («копейках»), поэтому умножаем на 100
    delivery: {
      courierFee: int('DELIVERY_COURIER_FEE', 500) * 100,
      postFee: int('DELIVERY_POST_FEE', 350) * 100,
      freeFrom: int('FREE_DELIVERY_FROM', 30000) * 100,
    },
  };
}

module.exports = { load };
