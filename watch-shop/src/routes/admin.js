'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { rateLimit, safeEqual } = require('../lib/security');
const { OrderError } = require('../lib/orders');
const f = require('../lib/format');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Тип изображения определяем по первым байтам, а не по имени файла
function detectImageExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

module.exports = function adminRoutes({ config, products, orders, security }) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

  // Всё внутри /admin не индексируется и не кэшируется
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.locals.meta = { title: `Админ-панель — ${config.shop.name}`, description: '', robots: 'noindex,nofollow' };
    res.locals.adminLayout = true;
    next();
  });

  // ----- Вход / выход -----

  router.get('/login', (req, res) => {
    if (req.isAdmin) return res.redirect('/admin');
    res.render('admin/login', { error: null });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!safeEqual(password, config.adminPassword)) {
      return res.status(401).render('admin/login', { error: 'Неверный пароль.' });
    }
    security.loginAdmin(res);
    res.redirect('/admin');
  });

  router.post('/logout', (req, res) => {
    security.logoutAdmin(res);
    res.redirect('/admin/login');
  });

  router.use(security.requireAdmin);

  // ----- Заказы -----

  router.get('/', (req, res) => {
    const status = f.ORDER_STATUSES[req.query.status] ? req.query.status : null;
    res.render('admin/orders', {
      list: orders.adminList(status),
      counts: orders.counts(),
      status,
    });
  });

  router.get('/orders/:id', (req, res, next) => {
    const order = orders.byId(Number.parseInt(req.params.id, 10));
    if (!order) return next();
    res.render('admin/order', { order, error: req.query.error || null });
  });

  router.post('/orders/:id/status', (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    const status = text(req.body.status, 20);
    if (!f.ORDER_STATUSES[status]) return res.redirect(`/admin/orders/${id}`);
    try {
      orders.setStatus(id, status);
    } catch (err) {
      if (!(err instanceof OrderError)) return next(err);
      return res.redirect(`/admin/orders/${id}?error=${encodeURIComponent(err.message)}`);
    }
    res.redirect(`/admin/orders/${id}`);
  });

  // ----- Товары -----

  router.get('/products', (req, res) => {
    res.render('admin/products', { list: products.adminList() });
  });

  const emptyForm = {
    name: '', brand: '', gender: 'men', movement: 'quartz', price: '', old_price: '', stock: '0',
    description: '', specs: '', is_active: true, is_featured: false, image: null,
  };

  const formView = (res, { product, form, errors, status = 200 }) =>
    res.status(status).render('admin/product-form', { product, form, errors, GENDERS: f.GENDERS, MOVEMENTS: f.MOVEMENT_ONE });

  router.get('/products/new', (req, res) => formView(res, { product: null, form: emptyForm, errors: [] }));

  const formFromProduct = (product) => ({
    name: product.name, brand: product.brand, gender: product.gender, movement: product.movement,
    price: f.moneyToInput(product.price),
    old_price: product.old_price ? f.moneyToInput(product.old_price) : '',
    stock: String(product.stock), description: product.description,
    specs: f.specsToText(product.specs),
    is_active: Boolean(product.is_active), is_featured: Boolean(product.is_featured), image: product.image,
  });

  router.get('/products/:id/edit', (req, res, next) => {
    const product = products.byId(Number.parseInt(req.params.id, 10));
    if (!product) return next();
    formView(res, { product, errors: [], form: formFromProduct(product) });
  });

  // Разбор и проверка формы товара. Для multipart тело читает multer, потом проверяем CSRF вручную.
  function parseProductForm(body) {
    const form = {
      name: text(body.name, 120),
      brand: text(body.brand, 60),
      gender: text(body.gender, 10),
      movement: text(body.movement, 12),
      price: text(body.price, 20),
      old_price: text(body.old_price, 20),
      stock: text(body.stock, 8),
      description: text(body.description, 5000),
      specs: text(body.specs, 3000),
      is_active: body.is_active === 'on',
      is_featured: body.is_featured === 'on',
    };
    const errors = [];
    const price = f.parseMoney(form.price);
    const oldPrice = form.old_price ? f.parseMoney(form.old_price) : null;
    const stock = /^\d{1,6}$/.test(form.stock) ? Number.parseInt(form.stock, 10) : null;

    if (form.name.length < 2) errors.push('Укажите название модели.');
    if (!form.brand) errors.push('Укажите бренд.');
    if (!f.GENDERS[form.gender]) errors.push('Выберите, для кого часы.');
    if (!f.MOVEMENT_ONE[form.movement]) errors.push('Выберите тип механизма.');
    if (price === null || price <= 0) errors.push('Цена должна быть числом больше нуля.');
    if (form.old_price && (oldPrice === null || (price !== null && oldPrice <= price))) {
      errors.push('Старая цена должна быть больше текущей (или оставьте поле пустым).');
    }
    if (stock === null) errors.push('Остаток — целое число от 0.');

    return {
      form,
      errors,
      data: {
        name: form.name, brand: form.brand, gender: form.gender, movement: form.movement,
        price, old_price: oldPrice, stock,
        description: form.description,
        specs: JSON.stringify(f.parseSpecs(form.specs)),
        is_active: form.is_active ? 1 : 0,
        is_featured: form.is_featured ? 1 : 0,
      },
    };
  }

  // Сохраняет файл фото, возвращает имя или null
  function storeImage(file) {
    const ext = detectImageExt(file.buffer);
    if (!ext) return { error: 'Фото должно быть в формате JPG, PNG или WebP.' };
    const name = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), file.buffer, { flag: 'wx' });
    return { name };
  }

  function removeImage(name) {
    if (!name || name !== path.basename(name)) return;
    fs.rmSync(path.join(config.uploadsDir, name), { force: true });
  }

  // Общий обработчик создания и редактирования
  function saveProduct(req, res, next, existing) {
    upload.single('image')(req, res, (uploadErr) => {
      if (uploadErr) {
        const message =
          uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Фото больше 5 МБ.' : 'Не удалось загрузить фото.';
        return formView(res, {
          product: existing, status: 422, errors: [message],
          form: existing ? formFromProduct(existing) : emptyForm,
        });
      }
      if (!security.csrfOk(req)) return security.csrfFail(res);

      const { form, errors, data } = parseProductForm(req.body);
      form.image = existing ? existing.image : null;

      let newImage = null;
      if (errors.length === 0 && req.file) {
        const stored = storeImage(req.file);
        if (stored.error) errors.push(stored.error);
        else newImage = stored.name;
      }
      if (errors.length > 0) return formView(res, { product: existing, form, errors, status: 422 });

      const keepImage = existing && req.body.remove_image !== 'on' ? existing.image : null;
      data.image = newImage || keepImage;

      try {
        if (existing) products.update(existing.id, data);
        else products.create(data);
      } catch (err) {
        if (newImage) removeImage(newImage);
        return next(err);
      }
      // Старое фото удаляем только после успешной записи в БД
      if (existing && existing.image && existing.image !== data.image) removeImage(existing.image);
      res.redirect('/admin/products');
    });
  }

  router.post('/products', (req, res, next) => saveProduct(req, res, next, null));

  router.post('/products/:id', (req, res, next) => {
    const existing = products.byId(Number.parseInt(req.params.id, 10));
    if (!existing) return next();
    saveProduct(req, res, next, existing);
  });

  router.post('/products/:id/delete', (req, res, next) => {
    const product = products.byId(Number.parseInt(req.params.id, 10));
    if (!product) return next();
    products.remove(product.id);
    removeImage(product.image);
    res.redirect('/admin/products');
  });

  return router;
};
