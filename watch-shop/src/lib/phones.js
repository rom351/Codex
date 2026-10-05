'use strict';

// Телефон для ссылки tel: -> "+380501234567"; null, если номер не похож на телефон
function toTel(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10 && digits.startsWith('0')) return `+38${digits}`; // 050 123 45 67
  return `+${digits}`;
}

// Строка из настроек "+380 50 111 22 33, 067 444 55 66" -> [{ display, tel }]
function parsePhones(raw) {
  return String(raw || '')
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((display) => ({ display, tel: toTel(display) }))
    .filter((p) => p.tel);
}

// Ключ для поиска одного и того же клиента: последние 9 цифр (без кода страны и нуля)
function phoneKey(raw) {
  return String(raw).replace(/\D/g, '').slice(-9);
}

module.exports = { toTel, parsePhones, phoneKey };
