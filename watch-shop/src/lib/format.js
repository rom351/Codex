'use strict';

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

function slugify(text) {
  const latin = String(text)
    .toLowerCase()
    .replace(/[а-яёіїєґ]/g, (ch) => TRANSLIT[ch] ?? '');
  return latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function createMoneyFormatter(currency) {
  // narrowSymbol: одинаковый знак (₴, ₽, $) в любой версии ICU, в том числе в браузере
  const whole = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const cents = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
  return (minor) => {
    const value = (Number(minor) || 0) / 100;
    return Number.isInteger(value) ? whole.format(value) : cents.format(value);
  };
}

// Дата из SQLite ("2026-10-05 14:47:09", UTC) -> "05.10.2026, 17:47" в нужном часовом поясе
function createDateFormatter(timeZone) {
  const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone, dateStyle: 'short', timeStyle: 'short' });
  return (sqliteUtc) => {
    const date = new Date(`${String(sqliteUtc).replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? String(sqliteUtc) : fmt.format(date);
  };
}

// "12 900" или "12900,50" -> минорные единицы; null при ошибке
function parseMoney(input) {
  const cleaned = String(input ?? '')
    .replace(/[\s ]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number.parseFloat(cleaned) * 100);
}

// Из «минорных» единиц в строку для поля формы
function moneyToInput(minor) {
  const value = (Number(minor) || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function parseSpecs(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(':');
      if (i < 1) return null;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      return key && value ? [key, value] : null;
    })
    .filter(Boolean)
    .slice(0, 30);
}

function specsToText(json) {
  try {
    return JSON.parse(json)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  } catch {
    return '';
  }
}

const GENDERS = { men: 'Мужские', women: 'Женские', unisex: 'Унисекс' };
const MOVEMENTS = {
  quartz: 'Кварцевые',
  mechanical: 'Механические',
  automatic: 'Автоподзавод',
  smart: 'Умные',
};
const MOVEMENT_ONE = {
  quartz: 'Кварц',
  mechanical: 'Механика',
  automatic: 'Автоподзавод',
  smart: 'Умные часы',
};
const ORDER_STATUSES = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  shipped: 'Отправлен',
  done: 'Выполнен',
  cancelled: 'Отменён',
};
const DELIVERY = { pickup: 'Самовывоз', courier: 'Курьером', post: 'Почтой' };
const DELIVERY_HINT = {
  pickup: 'Заберёте заказ сами, адрес уточним при подтверждении',
  courier: 'Привезём по адресу в удобное время',
  post: 'Новая почта (отделение, почтомат) или Укрпочта',
};
const LEAD_STATUSES = { new: 'Новая', in_progress: 'В работе', done: 'Обработана', spam: 'Спам' };
const LEAD_KINDS = { message: 'Сообщение', callback: 'Звонок' };
const PAYMENT = { cod: 'Оплата при получении', transfer: 'Перевод по реквизитам' };

module.exports = {
  slugify,
  createMoneyFormatter,
  createDateFormatter,
  parseMoney,
  moneyToInput,
  parseSpecs,
  specsToText,
  GENDERS,
  MOVEMENTS,
  MOVEMENT_ONE,
  ORDER_STATUSES,
  DELIVERY,
  DELIVERY_HINT,
  LEAD_STATUSES,
  LEAD_KINDS,
  PAYMENT,
};
