'use strict';

// Демонстрационный каталог. Бренды вымышленные. Цены в целых единицах валюты.
// Заменяется реальным ассортиментом через админ-панель (/admin).

const { slugify } = require('./lib/format');

const DEMO = [
  {
    brand: 'Nordhaus', name: 'Classic 40', gender: 'men', movement: 'automatic', price: 48900, old_price: null, stock: 5,
    featured: 1,
    description: 'Строгие классические часы с автоматическим заводом. Сапфировое стекло, прозрачная задняя крышка и ремешок из натуральной кожи.',
    specs: [['Диаметр корпуса', '40 мм'], ['Механизм', 'Автоподзавод, запас хода 40 ч'], ['Стекло', 'Сапфировое'], ['Водозащита', '50 м'], ['Ремешок', 'Натуральная кожа']],
  },
  {
    brand: 'Nordhaus', name: 'Diver 300', gender: 'men', movement: 'automatic', price: 72500, old_price: 79900, stock: 3,
    featured: 1,
    description: 'Дайверские часы с вращающимся безелем и светящимися метками. Рассчитаны на погружение до 300 метров.',
    specs: [['Диаметр корпуса', '43 мм'], ['Механизм', 'Автоподзавод'], ['Стекло', 'Сапфировое'], ['Водозащита', '300 м'], ['Браслет', 'Нержавеющая сталь']],
  },
  {
    brand: 'Aurelia', name: 'Petite Or', gender: 'women', movement: 'quartz', price: 18900, old_price: null, stock: 8,
    featured: 1,
    description: 'Небольшие элегантные часы с тонким корпусом цвета золота. Подойдут как к вечернему образу, так и на каждый день.',
    specs: [['Диаметр корпуса', '28 мм'], ['Механизм', 'Кварц'], ['Стекло', 'Минеральное'], ['Водозащита', '30 м'], ['Ремешок', 'Миланский браслет']],
  },
  {
    brand: 'Aurelia', name: 'Rose Square', gender: 'women', movement: 'quartz', price: 22400, old_price: 26900, stock: 4,
    featured: 0,
    description: 'Квадратный корпус цвета розового золота и тонкий кожаный ремешок. Лаконичный дизайн в стиле ар-деко.',
    specs: [['Размер корпуса', '26 × 26 мм'], ['Механизм', 'Кварц'], ['Стекло', 'Минеральное'], ['Водозащита', '30 м'], ['Ремешок', 'Кожа']],
  },
  {
    brand: 'Kronberg', name: 'Pilot Field', gender: 'men', movement: 'mechanical', price: 36700, old_price: null, stock: 6,
    featured: 1,
    description: 'Полевые часы в стиле авиаторов: крупные арабские цифры, контрастный циферблат и механизм ручного завода.',
    specs: [['Диаметр корпуса', '42 мм'], ['Механизм', 'Ручной завод, запас хода 46 ч'], ['Стекло', 'Сапфировое'], ['Водозащита', '100 м'], ['Ремешок', 'Кожа']],
  },
  {
    brand: 'Kronberg', name: 'Skeleton One', gender: 'men', movement: 'automatic', price: 89900, old_price: null, stock: 2,
    featured: 0,
    description: 'Скелетон: механизм виден через циферблат. Часы для тех, кому нравится наблюдать за работой ходового колеса.',
    specs: [['Диаметр корпуса', '41 мм'], ['Механизм', 'Автоподзавод, скелетонизированный'], ['Стекло', 'Сапфировое'], ['Водозащита', '50 м'], ['Ремешок', 'Кожа']],
  },
  {
    brand: 'Meridian', name: 'Everyday 38', gender: 'unisex', movement: 'quartz', price: 9900, old_price: null, stock: 15,
    featured: 1,
    description: 'Простые повседневные часы на каждый день. Лёгкий корпус, читаемый циферблат и ремешок, который удобно менять.',
    specs: [['Диаметр корпуса', '38 мм'], ['Механизм', 'Кварц'], ['Стекло', 'Минеральное'], ['Водозащита', '50 м'], ['Ремешок', 'Силикон / кожа']],
  },
  {
    brand: 'Meridian', name: 'Chrono Sport', gender: 'men', movement: 'quartz', price: 14500, old_price: 17900, stock: 9,
    featured: 0,
    description: 'Спортивный хронограф с секундомером и датой. Устойчив к влаге и ударам, подходит для активного образа жизни.',
    specs: [['Диаметр корпуса', '44 мм'], ['Механизм', 'Кварцевый хронограф'], ['Стекло', 'Минеральное, закалённое'], ['Водозащита', '100 м'], ['Ремешок', 'Силикон']],
  },
  {
    brand: 'Meridian', name: 'Lady Mini', gender: 'women', movement: 'quartz', price: 8700, old_price: null, stock: 12,
    featured: 0,
    description: 'Миниатюрные женские часы с чистым циферблатом. Легко сочетаются с любыми украшениями.',
    specs: [['Диаметр корпуса', '30 мм'], ['Механизм', 'Кварц'], ['Стекло', 'Минеральное'], ['Водозащита', '30 м'], ['Ремешок', 'Кожа']],
  },
  {
    brand: 'Nordhaus', name: 'Heritage Moon', gender: 'men', movement: 'automatic', price: 64200, old_price: null, stock: 0,
    featured: 0,
    description: 'Часы с индикацией фазы Луны на циферблате. Модель временно закончилась, ожидаем поставку.',
    specs: [['Диаметр корпуса', '40 мм'], ['Механизм', 'Автоподзавод, лунная фаза'], ['Стекло', 'Сапфировое'], ['Водозащита', '50 м'], ['Ремешок', 'Кожа']],
  },
  {
    brand: 'Aurelia', name: 'Pearl Dial', gender: 'women', movement: 'automatic', price: 41800, old_price: null, stock: 3,
    featured: 1,
    description: 'Женские механические часы с перламутровым циферблатом и тонким стальным браслетом.',
    specs: [['Диаметр корпуса', '33 мм'], ['Механизм', 'Автоподзавод'], ['Стекло', 'Сапфировое'], ['Водозащита', '50 м'], ['Браслет', 'Нержавеющая сталь']],
  },
  {
    brand: 'Pulse', name: 'Smart Active', gender: 'unisex', movement: 'smart', price: 15900, old_price: 18900, stock: 20,
    featured: 0,
    description: 'Умные часы с пульсометром, счётчиком шагов, уведомлениями и автономной работой до 7 дней.',
    specs: [['Экран', 'AMOLED 1,4"'], ['Датчики', 'Пульс, акселерометр, GPS'], ['Автономность', 'До 7 дней'], ['Водозащита', '50 м'], ['Ремешок', 'Силикон']],
  },
];

function seedDemo(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) return false;

  const insert = db.prepare(
    `INSERT INTO products
       (slug, name, brand, gender, movement, price, old_price, stock, description, specs, is_featured)
     VALUES (@slug, @name, @brand, @gender, @movement, @price, @old_price, @stock, @description, @specs, @featured)`,
  );
  db.transaction(() => {
    for (const p of DEMO) {
      insert.run({
        ...p,
        slug: slugify(`${p.brand} ${p.name}`),
        price: p.price * 100,
        old_price: p.old_price ? p.old_price * 100 : null,
        specs: JSON.stringify(p.specs),
      });
    }
  })();
  return true;
}

module.exports = { seedDemo };
