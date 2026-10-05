'use strict';

const crypto = require('node:crypto');

// ---------- Подписанные cookie (без внешних библиотек) ----------

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* битое значение игнорируем */
    }
  }
  return out;
}

// Значение вида  <base64url(json)>.<подпись>
function packSigned(data, secret) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function unpackSigned(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), sign(body, secret))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function setCookie(res, name, value, { maxAgeSec, secure, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  res.append('Set-Cookie', parts.join('; '));
}

// ---------- Middleware ----------

function createSecurity(config) {
  const secure = config.secureCookies;

  // Читает cookie, готовит req.cookies, req.cart и CSRF-токен
  function session(req, res, next) {
    req.cookies = parseCookies(req.headers.cookie);

    let csrf = req.cookies.csrf;
    if (!csrf || !/^[A-Za-z0-9_-]{32,64}$/.test(csrf)) {
      csrf = crypto.randomBytes(24).toString('base64url');
      setCookie(res, 'csrf', csrf, { secure, maxAgeSec: 60 * 60 * 24 * 30 });
    }
    req.csrfToken = csrf;
    res.locals.csrfToken = csrf;

    const cart = unpackSigned(req.cookies.cart, config.sessionSecret);
    req.cart = cart && typeof cart === 'object' && !Array.isArray(cart) ? cart : {};

    const admin = unpackSigned(req.cookies.admin, config.sessionSecret);
    req.isAdmin = Boolean(admin && admin.exp > Date.now());

    // Номер последнего оформленного заказа: только его владелец видит страницу «Спасибо»
    const last = unpackSigned(req.cookies.order, config.sessionSecret);
    req.lastOrderId = last && typeof last.id === 'string' ? last.id : null;

    next();
  }

  // Токен из формы (или заголовка) должен совпасть с токеном из cookie
  function csrfOk(req) {
    const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    return Boolean(sent) && safeEqual(sent, req.csrfToken);
  }

  // Защита POST-форм. Для multipart-форм (загрузка фото) тело ещё не разобрано,
  // поэтому там проверка вызывается вручную после multer.
  function csrfProtect(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!req.body && req.is('multipart/form-data')) return next();
    if (!csrfOk(req)) return csrfFail(res);
    next();
  }

  function csrfFail(res) {
    return res.status(403).render('error', {
      title: 'Форма устарела',
      message: 'Страница устарела или запрос отклонён. Вернитесь назад, обновите страницу и повторите.',
    });
  }

  function saveCart(res, cart) {
    setCookie(res, 'cart', packSigned(cart, config.sessionSecret), {
      secure,
      maxAgeSec: 60 * 60 * 24 * 30,
    });
  }

  function rememberOrder(res, publicId) {
    setCookie(res, 'order', packSigned({ id: publicId }, config.sessionSecret), {
      secure,
      maxAgeSec: 60 * 60 * 24,
    });
  }

  function loginAdmin(res) {
    const ttl = 60 * 60 * 8;
    setCookie(res, 'admin', packSigned({ exp: Date.now() + ttl * 1000 }, config.sessionSecret), {
      secure,
      maxAgeSec: ttl,
    });
  }

  function logoutAdmin(res) {
    setCookie(res, 'admin', '', { secure, maxAgeSec: 0 });
  }

  function requireAdmin(req, res, next) {
    if (req.isAdmin) return next();
    res.redirect('/admin/login');
  }

  // Заголовки безопасности
  function headers(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
        "form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  }

  return { session, csrfProtect, csrfOk, csrfFail, saveCart, rememberOrder, loginAdmin, logoutAdmin, requireAdmin, headers };
}

// ---------- Ограничитель частоты запросов (в памяти) ----------

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs);
  timer.unref();

  return function limiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).render('error', {
        title: 'Слишком много запросов',
        message: 'Вы отправили слишком много запросов. Подождите немного и повторите.',
      });
    }
    next();
  };
}

module.exports = { createSecurity, rateLimit, safeEqual };
