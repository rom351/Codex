'use strict';

// Выпадающие списки с атрибутом data-autosubmit отправляют форму сразу после выбора
document.querySelectorAll('[data-autosubmit]').forEach((el) => {
  el.addEventListener('change', () => el.form && el.form.submit());
});

// Подтверждение опасных действий (форма с атрибутом data-confirm)
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});

// Оформление заказа: пересчёт итога при смене способа доставки, скрытие адреса при самовывозе
const checkout = document.getElementById('checkout-form');
if (checkout) {
  const subtotal = Number(checkout.dataset.subtotal) || 0;
  const currency = checkout.dataset.currency || 'UAH';
  // narrowSymbol — тот же знак валюты, что и в страницах, отрисованных сервером
  const fmt = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
  const deliveryEl = document.getElementById('sum-delivery');
  const totalEl = document.getElementById('sum-total');
  const addressField = document.getElementById('address-field');
  const radios = checkout.querySelectorAll('input[name="delivery_method"]');

  const update = () => {
    const picked = checkout.querySelector('input[name="delivery_method"]:checked');
    if (!picked) return;
    const cost = Number(picked.dataset.cost) || 0;
    deliveryEl.textContent = cost === 0 ? 'бесплатно' : fmt.format(cost / 100);
    totalEl.textContent = fmt.format((subtotal + cost) / 100);
    addressField.hidden = picked.value === 'pickup';
  };
  radios.forEach((r) => r.addEventListener('change', update));
  update();
}
