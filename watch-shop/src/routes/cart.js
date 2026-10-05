'use strict';

const express = require('express');
const { rateLimit } = require('../lib/security');
const { OrderError, MAX_QTY_PER_LINE } = require('../lib/orders');
const { DELIVERY, PAYMENT } = require('../lib/format');

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Проверка данных формы оформления заказа
function validateCheckout(body) {
  const form = {
    customer_name: text(body.customer_name, 100),
    phone: text(body.phone, 30),
    email: text(body.email, 120),
    delivery_method: text(body.delivery_method, 10),
    address: text(body.address, 300),
    payment_method: text(body.payment_method, 10),
    comment: text(body.comment, 500),
  };
  const errors = [];

  if (form.customer_name.length < 2) errors.push('Укажите имя.');
  const digits = form.phone.replace(/\D/g, '');
  if (!/^[\d\s()+\-]+$/.test(form.phone) || digits.length < 10 || digits.length > 15) {
    errors.push('Укажите телефон в формате +7 900 123-45-67.');
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) errors.push('Проверьте адрес электронной почты.');
  if (!DELIVERY[form.delivery_method]) errors.push('Выберите способ получения.');
  else if (form.delivery_method !== 'pickup' && form.address.length < 5) errors.push('Укажите адрес доставки.');
  if (form.delivery_method === 'pickup') form.address = '';
  if (!PAYMENT[form.payment_method]) errors.push('Выберите способ оплаты.');
  if (body.consent !== 'on') errors.push('Нужно согласие на обработку персональных данных.');

  return { form, errors };
}

module.exports = function cartRoutes({ config, products, orders, security, money }) {
  const router = express.Router();
  const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });

  router.get('/cart', (req, res) => {
    const cart = orders.resolveCart(req.cart);
    // Если из-за остатков корзина «усохла», обновляем cookie
    const clean = Object.fromEntries(cart.lines.map((l) => [l.product.id, l.qty]));
    security.saveCart(res, clean);
    res.render('cart', {
      cart,
      freeFrom: config.delivery.freeFrom,
      MAX_QTY: MAX_QTY_PER_LINE,
      meta: { title: `Корзина — ${config.shop.name}`, description: 'Корзина', robots: 'noindex,nofollow' },
    });
  });

  router.post('/cart/add', (req, res) => {
    const id = positiveInt(req.body.product_id);
    const product = id ? products.byId(id) : null;
    if (!product || !product.is_active) return res.redirect('/catalog');
    if (product.stock < 1) return res.redirect(`/watch/${product.slug}`);

    const qty = Math.max(1, positiveInt(req.body.qty) || 1);
    const next = { ...req.cart };
    next[product.id] = Math.min((Number(next[product.id]) || 0) + qty, product.stock, MAX_QTY_PER_LINE);
    security.saveCart(res, next);

    // «Купить сразу» ведёт в корзину, обычное добавление возвращает на карточку
    if (req.body.buy_now === '1') return res.redirect('/cart');
    res.redirect(`/watch/${product.slug}?added=1`);
  });

  router.post('/cart/set', (req, res) => {
    const id = positiveInt(req.body.product_id);
    const qty = positiveInt(req.body.qty);
    const next = { ...req.cart };
    if (id !== null) {
      if (!qty) delete next[id];
      else next[id] = Math.min(qty, MAX_QTY_PER_LINE);
    }
    security.saveCart(res, next);
    res.redirect('/cart');
  });

  router.get('/checkout', (req, res) => {
    const cart = orders.resolveCart(req.cart);
    if (cart.lines.length === 0) return res.redirect('/cart');
    res.render('checkout', {
      cart,
      form: { delivery_method: 'courier', payment_method: 'cod' },
      errors: [],
      costs: {
        pickup: orders.deliveryCost('pickup', cart.subtotal),
        courier: orders.deliveryCost('courier', cart.subtotal),
        post: orders.deliveryCost('post', cart.subtotal),
      },
      DELIVERY,
      PAYMENT,
      meta: { title: `Оформление заказа — ${config.shop.name}`, description: 'Оформление заказа', robots: 'noindex,nofollow' },
    });
  });

  router.post('/checkout', checkoutLimiter, (req, res) => {
    const cart = orders.resolveCart(req.cart);
    if (cart.lines.length === 0) return res.redirect('/cart');

    const { form, errors } = validateCheckout(req.body);
    // Скрытое поле-ловушка для ботов: человек его не заполняет
    if (text(req.body.website, 100)) errors.push('Не удалось отправить форму.');

    let placed = null;
    if (errors.length === 0) {
      try {
        placed = orders.place(form, req.cart);
      } catch (err) {
        if (!(err instanceof OrderError)) throw err;
        errors.push(err.message);
      }
    }

    if (!placed) {
      return res.status(422).render('checkout', {
        cart,
        form,
        errors,
        costs: {
          pickup: orders.deliveryCost('pickup', cart.subtotal),
          courier: orders.deliveryCost('courier', cart.subtotal),
          post: orders.deliveryCost('post', cart.subtotal),
        },
        DELIVERY,
        PAYMENT,
        meta: { title: `Оформление заказа — ${config.shop.name}`, description: 'Оформление заказа', robots: 'noindex,nofollow' },
      });
    }

    security.saveCart(res, {});
    security.rememberOrder(res, placed.publicId);
    res.redirect(`/order/${placed.publicId}`);
  });

  router.get('/order/:publicId', (req, res, next) => {
    // Страницу видит только тот, кто оформил заказ (номер лежит в подписанной cookie)
    if (req.lastOrderId !== req.params.publicId) return next();
    const order = orders.byPublicId(req.params.publicId);
    if (!order) return next();
    res.render('order-done', {
      order,
      DELIVERY,
      PAYMENT,
      money,
      meta: { title: `Заказ ${order.public_id} — ${config.shop.name}`, description: 'Заказ оформлен', robots: 'noindex,nofollow' },
    });
  });

  return router;
};
