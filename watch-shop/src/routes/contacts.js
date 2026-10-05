'use strict';

const express = require('express');
const { rateLimit } = require('../lib/security');
const { toTel } = require('../lib/phones');

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Проверка формы «Написать нам» / «Заказать звонок»
function validateLead(body) {
  const kind = body.kind === 'callback' ? 'callback' : 'message';
  const data = {
    kind,
    name: text(body.name, 100),
    phone: text(body.phone, 30),
    email: text(body.email, 120),
    message: text(body.message, 1500),
    source: text(body.source, 60),
  };
  const errors = [];
  if (data.name.length < 2) errors.push('Укажите имя.');
  if (!toTel(data.phone) || !/^[\d\s()+\-]+$/.test(data.phone)) errors.push('Укажите телефон в формате +380 50 123-45-67.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.push('Проверьте адрес электронной почты.');
  if (kind === 'message' && data.message.length < 5) errors.push('Напишите ваш вопрос или сообщение.');
  if (body.consent !== 'on') errors.push('Нужно согласие на обработку персональных данных.');
  return { data, errors };
}

module.exports = function contactsRoutes({ config, leads }) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });

  const view = (res, { status = 200, sent = null, errors = [], form = {} }) =>
    res.status(status).render('page-contacts', {
      title: 'Контакты',
      sent,
      errors,
      form,
      meta: {
        title: `Контакты — ${config.shop.name}`,
        description: `Контакты магазина ${config.shop.name}: телефоны, адрес, форма обратной связи и заказ звонка.`,
        canonical: `${config.siteUrl}/contacts`,
      },
    });

  router.get('/contacts', (req, res) => {
    view(res, { sent: ['message', 'callback'].includes(req.query.sent) ? req.query.sent : null });
  });

  router.post('/contacts', limiter, (req, res) => {
    const { data, errors } = validateLead(req.body);
    // Скрытое поле-ловушка для ботов: человек его не заполняет
    if (text(req.body.website, 100)) return view(res, { status: 422, errors: ['Не удалось отправить форму.'], form: data });
    if (errors.length) return view(res, { status: 422, errors, form: data });

    leads.create(data);
    res.redirect(`/contacts?sent=${data.kind}#${data.kind === 'callback' ? 'callback' : 'message'}`);
  });

  return router;
};
