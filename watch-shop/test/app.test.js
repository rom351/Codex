'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { load } = require('../src/config');
const { createApp } = require('../src/app');

// ---------- Вспомогательные функции ----------

function startShop(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-shop-'));
  const config = load({
    DATA_DIR: dataDir,
    DB_FILE: ':memory:',
    SEED_DEMO: 'true',
    ADMIN_PASSWORD: 'test-password-123',
    SESSION_SECRET: 'x'.repeat(40),
    NODE_ENV: 'test',
    CURRENCY: 'UAH',
    DELIVERY_COURIER_FEE: '500',
    DELIVERY_POST_FEE: '350',
    FREE_DELIVERY_FROM: '30000',
    ...extra,
  });
  const app = createApp(config);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    config,
    base,
    db: app.get('db'),
    async close() {
      await new Promise((r) => server.close(r));
      app.locals.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Мини-клиент с cookie
function client(base) {
  const jar = new Map();
  async function request(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { ...opts, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (/max-age=0/i.test(c)) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
  const api = {
    request,
    get: (url) => request(url),
    async text(url) {
      return (await request(url)).text();
    },
    async post(url, fields = {}, { csrf = true } = {}) {
      if (!jar.has('csrf')) await request('/healthz-warmup');
      const body = new URLSearchParams(csrf ? { _csrf: jar.get('csrf'), ...fields } : fields);
      return request(url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    },
    async postMultipart(url, fields, file) {
      if (!jar.has('csrf')) await request('/healthz-warmup');
      const form = new FormData();
      form.set('_csrf', jar.get('csrf'));
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      if (file) form.set('image', new Blob([file.data], { type: file.type }), file.name);
      return request(url, { method: 'POST', body: form });
    },
  };
  return api;
}

const VALID_ORDER = {
  customer_name: 'Иван Петров',
  phone: '+380 50 123-45-67',
  email: 'ivan@example.com',
  delivery_method: 'courier',
  address: 'Киев, ул. Хрещатик, 1, кв. 2',
  payment_method: 'cod',
  consent: 'on',
};

const stockOf = (db, slug) => db.prepare('SELECT stock FROM products WHERE slug = ?').get(slug).stock;
const idOf = (db, slug) => db.prepare('SELECT id FROM products WHERE slug = ?').get(slug).id;

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ---------- Витрина ----------

test('витрина: главная, каталог, карточка, служебные страницы', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);

  for (const url of ['/', '/catalog', '/delivery', '/about', '/contacts', '/privacy', '/robots.txt', '/sitemap.xml']) {
    assert.equal((await c.get(url)).status, 200, url);
  }
  const home = await c.text('/');
  assert.match(home, /Часовая лавка/);

  const product = await c.get('/watch/nordhaus-classic-40');
  assert.equal(product.status, 200);
  assert.match(await product.text(), /Classic 40/);

  assert.equal((await c.get('/watch/net-takih')).status, 404);
  assert.equal((await c.get('/nope')).status, 404);
  assert.match(await c.text('/sitemap.xml'), /nordhaus-classic-40/);
});

test('каталог: фильтры, поиск без учёта регистра, сортировка, пагинация', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);

  const women = await c.text('/catalog?gender=women');
  assert.match(women, /Petite Or/);
  assert.doesNotMatch(women, /Diver 300/);

  assert.match(await c.text('/catalog?q=CLASSIC'), /Classic 40/);
  assert.match(await c.text('/catalog?q=zzzz'), /Ничего не найдено/);
  assert.match(await c.text('/catalog?stock=1'), /Diver 300/);
  assert.doesNotMatch(await c.text('/catalog?stock=1'), /Heritage Moon/);

  // дешёвые раньше дорогих
  const asc = await c.text('/catalog?sort=price_asc');
  assert.ok(asc.indexOf('Lady Mini') < asc.indexOf('Skeleton One'));

  // страница за пределами диапазона не ломает каталог; SQL-мусор в параметрах безопасен
  assert.equal((await c.get('/catalog?page=999')).status, 200);
  assert.equal((await c.get("/catalog?brand=' OR 1=1 --&min=abc&gender=zzz")).status, 200);
});

test('заголовки безопасности выставлены', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const res = await client(shop.base).get('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

// ---------- Корзина и заказ ----------

test('корзина: добавление, изменение количества, удаление, лимит по остатку', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);

  const id = idOf(shop.db, 'nordhaus-classic-40'); // остаток 5
  assert.equal((await c.post('/cart/add', { product_id: id, qty: '2' })).status, 302);
  assert.match(await c.text('/cart'), /Classic 40/);

  await c.post('/cart/add', { product_id: id, qty: '9' });
  assert.match(await c.text('/cart'), /<option value="5" selected>/, 'не больше остатка');

  await c.post('/cart/set', { product_id: id, qty: '3' });
  assert.match(await c.text('/cart'), /<option value="3" selected>/);

  await c.post('/cart/set', { product_id: id, qty: '0' });
  assert.match(await c.text('/cart'), /В корзине пока пусто/);

  // товар «нет в наличии» добавить нельзя
  await c.post('/cart/add', { product_id: idOf(shop.db, 'nordhaus-heritage-moon'), qty: '1' });
  assert.match(await c.text('/cart'), /В корзине пока пусто/);
});

test('подделанная cookie корзины игнорируется', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);
  await c.get('/');
  const forged = Buffer.from(JSON.stringify({ 1: 5 })).toString('base64url') + '.fakesignature';
  const res = await fetch(`${shop.base}/cart`, { headers: { cookie: `cart=${forged}` } });
  assert.match(await res.text(), /В корзине пока пусто/);
});

test('заказ: CSRF, валидация, списание остатков, страница «спасибо» только владельцу', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);
  const slug = 'nordhaus-classic-40';
  const id = idOf(shop.db, slug);
  const before = stockOf(shop.db, slug);

  // без CSRF-токена запрос отклоняется
  assert.equal((await c.post('/cart/add', { product_id: id, qty: '1' }, { csrf: false })).status, 403);

  await c.post('/cart/add', { product_id: id, qty: '2' });
  assert.equal((await c.get('/checkout')).status, 200);

  // пустые/неверные данные
  const bad = await c.post('/checkout', { ...VALID_ORDER, customer_name: '', phone: 'abc', consent: '' });
  assert.equal(bad.status, 422);
  const badHtml = await bad.text();
  assert.match(badHtml, /Укажите имя/);
  assert.match(badHtml, /Укажите телефон/);
  assert.match(badHtml, /согласие/);
  assert.equal(stockOf(shop.db, slug), before, 'при ошибке остаток не меняется');

  // бот заполнил скрытое поле
  assert.equal((await c.post('/checkout', { ...VALID_ORDER, website: 'spam.example' })).status, 422);

  // доставка без адреса
  assert.equal((await c.post('/checkout', { ...VALID_ORDER, address: '' })).status, 422);

  // успешный заказ
  const ok = await c.post('/checkout', VALID_ORDER);
  assert.equal(ok.status, 302);
  const location = ok.headers.get('location');
  assert.match(location, /^\/order\/[A-Z0-9]{6}$/);

  const order = shop.db.prepare('SELECT * FROM orders').get();
  assert.equal(order.customer_name, 'Иван Петров');
  assert.equal(order.subtotal, 48900 * 100 * 2);
  assert.equal(order.delivery_cost, 0, 'выше порога бесплатной доставки');
  assert.equal(order.total, order.subtotal);
  assert.equal(stockOf(shop.db, slug), before - 2, 'остаток списан');

  // корзина очищена, страница заказа видна владельцу
  assert.match(await c.text('/cart'), /В корзине пока пусто/);
  const done = await c.get(location);
  assert.equal(done.status, 200);
  assert.match(await done.text(), new RegExp(order.public_id));

  // чужой человек номер заказа не видит
  assert.equal((await client(shop.base).get(location)).status, 404);
});

test('заказ: платная доставка ниже порога и бесплатный самовывоз', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const cheap = idOf(shop.db, 'meridian-lady-mini'); // 8 700

  let c = client(shop.base);
  await c.post('/cart/add', { product_id: cheap, qty: '1' });
  await c.post('/checkout', { ...VALID_ORDER, delivery_method: 'courier' });
  let o = shop.db.prepare('SELECT * FROM orders ORDER BY id DESC').get();
  assert.equal(o.delivery_cost, shop.config.delivery.courierFee);
  assert.equal(o.total, 8700 * 100 + shop.config.delivery.courierFee);

  c = client(shop.base);
  await c.post('/cart/add', { product_id: cheap, qty: '1' });
  await c.post('/checkout', { ...VALID_ORDER, delivery_method: 'pickup', address: '' });
  o = shop.db.prepare('SELECT * FROM orders ORDER BY id DESC').get();
  assert.equal(o.delivery_cost, 0);
  assert.equal(o.address, '');
});

test('заказ: цена в заказе — снимок, а не ссылка на текущую цену', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);
  const id = idOf(shop.db, 'meridian-everyday-38');
  await c.post('/cart/add', { product_id: id, qty: '1' });
  await c.post('/checkout', VALID_ORDER);
  shop.db.prepare('UPDATE products SET price = 1 WHERE id = ?').run(id);
  const item = shop.db.prepare('SELECT * FROM order_items').get();
  assert.equal(item.price, 9900 * 100);
});

test('заказ: нельзя купить больше остатка (гонка двух корзин)', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const slug = 'kronberg-skeleton-one'; // остаток 2
  const id = idOf(shop.db, slug);

  const a = client(shop.base);
  const b = client(shop.base);
  await a.post('/cart/add', { product_id: id, qty: '2' });
  await b.post('/cart/add', { product_id: id, qty: '2' });

  assert.equal((await a.post('/checkout', VALID_ORDER)).status, 302);
  const second = await b.post('/checkout', VALID_ORDER);
  // товара уже нет — покупателя возвращают в корзину, заказ не создаётся
  assert.equal(second.headers.get('location'), '/cart');
  assert.equal(stockOf(shop.db, slug), 0);
  assert.equal(shop.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});

// ---------- Админ-панель ----------

async function adminLogin(shop) {
  const c = client(shop.base);
  const res = await c.post('/admin/login', { password: 'test-password-123' });
  assert.equal(res.status, 302);
  return c;
}

test('админка: закрыта без входа, неверный пароль отклоняется', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);

  for (const url of ['/admin', '/admin/products', '/admin/products/new', '/admin/orders/1']) {
    const res = await c.get(url);
    assert.equal(res.status, 302, url);
    assert.equal(res.headers.get('location'), '/admin/login');
  }
  assert.equal((await c.post('/admin/products/1/delete')).status, 302, 'без входа — только редирект');
  assert.equal(stockOf(shop.db, 'nordhaus-classic-40') > 0, true);
  assert.ok(shop.db.prepare('SELECT 1 FROM products WHERE id = 1').get(), 'товар не удалён');

  assert.equal((await c.post('/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await c.post('/admin/login', { password: 'test-password-123' })).status, 302);
  assert.equal((await c.get('/admin')).status, 200);

  // выход закрывает доступ
  await c.post('/admin/logout');
  assert.equal((await c.get('/admin')).status, 302);
});

test('админка: подделанная cookie входа не работает', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url') + '.abc';
  const res = await fetch(`${shop.base}/admin`, { headers: { cookie: `admin=${forged}` }, redirect: 'manual' });
  assert.equal(res.status, 302);
});

test('админка: смена статуса, отмена возвращает товар на склад', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const slug = 'nordhaus-classic-40';
  const id = idOf(shop.db, slug);
  const before = stockOf(shop.db, slug);

  const buyer = client(shop.base);
  await buyer.post('/cart/add', { product_id: id, qty: '2' });
  await buyer.post('/checkout', VALID_ORDER);
  assert.equal(stockOf(shop.db, slug), before - 2);
  const order = shop.db.prepare('SELECT * FROM orders').get();

  const admin = await adminLogin(shop);
  assert.match(await admin.text('/admin'), new RegExp(order.public_id));
  assert.equal((await admin.get(`/admin/orders/${order.id}`)).status, 200);

  await admin.post(`/admin/orders/${order.id}/status`, { status: 'confirmed' });
  assert.equal(shop.db.prepare('SELECT status FROM orders').get().status, 'confirmed');
  assert.equal(stockOf(shop.db, slug), before - 2);

  await admin.post(`/admin/orders/${order.id}/status`, { status: 'cancelled' });
  assert.equal(stockOf(shop.db, slug), before, 'отмена вернула остаток');

  // повторная отмена остаток не удваивает
  await admin.post(`/admin/orders/${order.id}/status`, { status: 'cancelled' });
  assert.equal(stockOf(shop.db, slug), before);

  // возврат из отмены снова списывает
  await admin.post(`/admin/orders/${order.id}/status`, { status: 'new' });
  assert.equal(stockOf(shop.db, slug), before - 2);

  // неизвестный статус игнорируется
  await admin.post(`/admin/orders/${order.id}/status`, { status: 'hacked' });
  assert.equal(shop.db.prepare('SELECT status FROM orders').get().status, 'new');
});

test('админка: создание, поиск по кириллице, редактирование и удаление товара с фото', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const admin = await adminLogin(shop);

  const fields = {
    brand: 'Ракета', name: 'Классика 42', gender: 'men', movement: 'mechanical',
    price: '25 500', old_price: '29900', stock: '4',
    description: 'Описание модели', specs: 'Диаметр: 42 мм\nВодозащита: 50 м',
    is_active: 'on', is_featured: 'on',
  };
  const created = await admin.postMultipart('/admin/products', fields, { data: PNG, type: 'image/png', name: 'x.png' });
  assert.equal(created.status, 302, await created.clone().text());

  const row = shop.db.prepare("SELECT * FROM products WHERE brand = 'Ракета'").get();
  assert.equal(row.price, 2550000);
  assert.equal(row.old_price, 2990000);
  assert.equal(row.slug, 'raketa-klassika-42');
  assert.match(row.image, /^[0-9a-f]{24}\.png$/);
  assert.ok(fs.existsSync(path.join(shop.config.uploadsDir, row.image)), 'файл сохранён');

  const pub = client(shop.base);
  assert.match(await pub.text('/catalog?q=КЛАССИКА'), /Классика 42/, 'поиск по кириллице без учёта регистра');
  assert.match(await pub.text('/watch/raketa-klassika-42'), /Диаметр/);
  const img = await pub.get(`/uploads/${row.image}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/png/);

  // редактирование: меняем цену, фото остаётся
  await admin.postMultipart(`/admin/products/${row.id}`, { ...fields, price: '20000', old_price: '' });
  const edited = shop.db.prepare('SELECT * FROM products WHERE id = ?').get(row.id);
  assert.equal(edited.price, 2000000);
  assert.equal(edited.old_price, null);
  assert.equal(edited.image, row.image);

  // удаление фото галочкой
  await admin.postMultipart(`/admin/products/${row.id}`, { ...fields, remove_image: 'on' });
  assert.equal(shop.db.prepare('SELECT image FROM products WHERE id = ?').get(row.id).image, null);
  assert.equal(fs.existsSync(path.join(shop.config.uploadsDir, row.image)), false, 'файл удалён с диска');

  // скрытый товар не виден на витрине
  await admin.postMultipart(`/admin/products/${row.id}`, { ...fields, is_active: '' });
  assert.equal((await pub.get('/watch/raketa-klassika-42')).status, 404);

  // удаление
  assert.equal((await admin.post(`/admin/products/${row.id}/delete`)).status, 302);
  assert.equal(shop.db.prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?').get(row.id).n, 0);
});

test('админка: валидация формы и защита загрузки', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const admin = await adminLogin(shop);
  const count = () => shop.db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const before = count();

  const base = { brand: 'Тест', name: 'Модель', gender: 'men', movement: 'quartz', price: '1000', old_price: '', stock: '1', description: '', specs: '', is_active: 'on' };

  // пустые и неверные поля
  const bad = await admin.postMultipart('/admin/products', { ...base, name: '', price: 'abc', stock: '-1' });
  assert.equal(bad.status, 422);
  const html = await bad.text();
  assert.match(html, /Укажите название/);
  assert.match(html, /Цена должна быть/);
  assert.match(html, /Остаток/);

  // старая цена не выше текущей
  assert.equal((await admin.postMultipart('/admin/products', { ...base, old_price: '500' })).status, 422);

  // не картинка под видом картинки
  const fake = await admin.postMultipart('/admin/products', base, {
    data: Buffer.from('<?php echo 1; ?>  not an image at all'), type: 'image/png', name: 'shell.png',
  });
  assert.equal(fake.status, 422);
  assert.match(await fake.text(), /JPG, PNG или WebP/);
  assert.deepEqual(fs.readdirSync(shop.config.uploadsDir), [], 'на диск ничего не записано');

  // слишком большой файл
  const big = await admin.postMultipart('/admin/products', base, {
    data: Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), type: 'image/png', name: 'big.png',
  });
  assert.equal(big.status, 422);
  assert.match(await big.text(), /больше 5 МБ/);

  // multipart без CSRF-токена
  const form = new FormData();
  for (const [k, v] of Object.entries(base)) form.set(k, v);
  const noCsrf = await admin.request('/admin/products', { method: 'POST', body: form });
  assert.equal(noCsrf.status, 403);

  assert.equal(count(), before, 'ни один некорректный товар не создан');
});

test('экранирование: HTML в названии не превращается в разметку', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const admin = await adminLogin(shop);
  await admin.postMultipart('/admin/products', {
    brand: 'X', name: '<script>alert(1)</script>', gender: 'men', movement: 'quartz',
    price: '100', stock: '1', description: '<img src=x onerror=alert(1)>', specs: '', is_active: 'on',
  });
  const html = await client(shop.base).text('/catalog');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

// ---------- Конфигурация ----------

test('гривна: цены на витрине и в корзине показываются в ₴', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);

  assert.match(await c.text('/watch/nordhaus-classic-40'), /48\s900\s₴/);
  assert.doesNotMatch(await c.text('/catalog'), /₽/);

  await c.post('/cart/add', { product_id: idOf(shop.db, 'meridian-lady-mini'), qty: '1' });
  const checkout = await c.text('/checkout');
  assert.match(checkout, /8\s700\s₴/);
  assert.match(checkout, /500\s₴/, 'курьер');
  assert.match(checkout, /placeholder="\+380 50 123-45-67"/);
  assert.match(checkout, /data-currency="UAH"/);
});

test('время заказа в админке показывается по Киеву, а не по UTC', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const buyer = client(shop.base);
  await buyer.post('/cart/add', { product_id: idOf(shop.db, 'meridian-lady-mini'), qty: '1' });
  await buyer.post('/checkout', VALID_ORDER);
  // летнее время Киева: UTC+3, зимнее: UTC+2
  shop.db.prepare("UPDATE orders SET created_at = '2026-07-01 10:00:00'").run();

  const admin = await adminLogin(shop);
  assert.match(await admin.text('/admin'), /01\.07\.2026, 13:00/);
  const id = shop.db.prepare('SELECT id FROM orders').get().id;
  const page = await admin.text(`/admin/orders/${id}`);
  assert.match(page, /01\.07\.2026, 13:00/);

  shop.db.prepare("UPDATE orders SET created_at = '2026-12-01 10:00:00'").run();
  assert.match(await admin.text('/admin'), /01\.12\.2026, 12:00/);
});

// ---------- Телефоны, контакты, заявки ----------

const LEAD = { kind: 'message', name: 'Мария', phone: '050 123 45 67', email: 'maria@example.com', message: 'Подскажите, есть ли Classic 40 в чёрном цвете?', consent: 'on' };

test('шапка и подвал: телефоны — кликабельные ссылки tel:, есть «Заказать звонок»', async (t) => {
  const shop = startShop({ SHOP_PHONE: '+380 50 111 22 33, 067 444 55 66' });
  t.after(() => shop.close());
  const html = await client(shop.base).text('/catalog');

  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /href="tel:\+380501112233"[^>]*>\+380 50 111 22 33</);
  assert.match(header, /href="tel:\+380674445566"[^>]*>067 444 55 66</, 'местный номер приводится к международному');
  assert.match(header, /href="\/contacts#callback"[^>]*>Заказать звонок</);
  const footer = html.slice(html.indexOf('<footer'));
  assert.match(footer, /href="tel:\+380501112233"/);
});

test('телефоны: разбор настроек, в боевом режиме по умолчанию пусто', () => {
  const { parsePhones, toTel, phoneKey } = require('../src/lib/phones');
  assert.equal(toTel('050 123-45-67'), '+380501234567');
  assert.equal(toTel('+38 (050) 123-45-67'), '+380501234567');
  assert.equal(toTel('12345'), null);
  assert.deepEqual(parsePhones('+380 50 111 22 33; abc, 067 444 55 66').map((p) => p.tel), ['+380501112233', '+380674445566']);
  assert.equal(phoneKey('+380 (50) 123-45-67'), phoneKey('050 123 45 67'));
  const prod = load({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'long-enough-pass' });
  assert.deepEqual(prod.shop.phones, []);
  assert.equal(prod.shop.email, '');
});

test('контакты: форма сообщения и заказ звонка сохраняются как заявки', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);
  const leads = () => shop.db.prepare('SELECT * FROM leads ORDER BY id').all();

  assert.match(await c.text('/contacts'), /Заказать звонок/);

  // сообщение
  const sent = await c.post('/contacts', LEAD);
  assert.equal(sent.status, 302);
  assert.equal(sent.headers.get('location'), '/contacts?sent=message#message');
  assert.match(await c.text('/contacts?sent=message'), /Сообщение отправлено/);
  assert.equal(leads().length, 1);
  assert.equal(leads()[0].status, 'new');
  assert.equal(leads()[0].phone, '050 123 45 67');

  // звонок: достаточно имени и телефона
  const cb = await c.post('/contacts', { kind: 'callback', name: 'Олег', phone: '+380 67 000 11 22', consent: 'on' });
  assert.equal(cb.headers.get('location'), '/contacts?sent=callback#callback');
  assert.equal(leads().length, 2);
  assert.equal(leads()[1].kind, 'callback');

  // ошибки: ничего не сохраняется, введённое не теряется
  const bad = await c.post('/contacts', { ...LEAD, name: '', phone: 'abc', message: 'ок', consent: '' });
  assert.equal(bad.status, 422);
  const html = await bad.text();
  assert.match(html, /Укажите имя/);
  assert.match(html, /Укажите телефон/);
  assert.match(html, /Напишите ваш вопрос/);
  assert.match(html, /согласие/);
  assert.equal(leads().length, 2);

  // бот заполнил скрытое поле; запрос без CSRF
  assert.equal((await c.post('/contacts', { ...LEAD, website: 'spam.example' })).status, 422);
  assert.equal((await c.post('/contacts', LEAD, { csrf: false })).status, 403);
  assert.equal(leads().length, 2);
});

test('контакты: ограничение частоты отправки форм', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());
  const c = client(shop.base);
  let last;
  for (let i = 0; i < 9; i++) last = await c.post('/contacts', LEAD);
  assert.equal(last.status, 429);
  assert.ok(shop.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n <= 8);
});

test('админка: заявки — список, статус, заметка, связь с заказами по телефону', async (t) => {
  const shop = startShop();
  t.after(() => shop.close());

  // клиент оставил заявку и отдельно сделал заказ с тем же номером (в другой записи)
  const buyer = client(shop.base);
  await buyer.post('/contacts', { ...LEAD, message: '<b>Привет</b> вопрос по часам' });
  await buyer.post('/cart/add', { product_id: idOf(shop.db, 'meridian-lady-mini'), qty: '1' });
  await buyer.post('/checkout', { ...VALID_ORDER, phone: '+380 50 123 45 67' });
  const lead = shop.db.prepare('SELECT * FROM leads').get();
  const order = shop.db.prepare('SELECT * FROM orders').get();

  // без входа закрыто
  const anon = client(shop.base);
  assert.equal((await anon.get('/admin/leads')).status, 302);
  assert.equal((await anon.post(`/admin/leads/${lead.id}`, { status: 'done' })).status, 302);
  assert.equal(shop.db.prepare('SELECT status FROM leads').get().status, 'new');

  const admin = await adminLogin(shop);
  const listHtml = await admin.text('/admin/leads');
  assert.match(listHtml, /Мария/);
  assert.match(listHtml, /href="tel:\+380501234567"/);
  assert.match(await admin.text('/admin'), /<span class="nav-badge">1<\/span>/, 'счётчик новых заявок в меню');

  const detail = await admin.text(`/admin/leads/${lead.id}`);
  assert.match(detail, /&lt;b&gt;Привет&lt;\/b&gt;/, 'HTML в сообщении экранируется');
  assert.match(detail, new RegExp(order.public_id), 'заказ клиента виден в карточке заявки');

  // в карточке заказа видна заявка клиента
  assert.match(await admin.text(`/admin/orders/${order.id}`), new RegExp(`/admin/leads/${lead.id}`));

  // смена статуса и заметка
  await admin.post(`/admin/leads/${lead.id}`, { status: 'in_progress', note: 'Перезвонить завтра' });
  let row = shop.db.prepare('SELECT * FROM leads').get();
  assert.equal(row.status, 'in_progress');
  assert.equal(row.note, 'Перезвонить завтра');
  assert.match(await admin.text('/admin/leads?status=in_progress'), /Мария/);
  assert.doesNotMatch(await admin.text('/admin'), /nav-badge/, 'новых заявок не осталось');

  // неизвестный статус игнорируется
  await admin.post(`/admin/leads/${lead.id}`, { status: 'hacked', note: '' });
  assert.equal(shop.db.prepare('SELECT status FROM leads').get().status, 'in_progress');
  assert.equal((await admin.get('/admin/leads/9999')).status, 404);
});

test('доставка и оплата: структура страницы и цифры берутся из настроек', async (t) => {
  const shop = startShop({ DELIVERY_COURIER_FEE: '200', DELIVERY_POST_FEE: '80', FREE_DELIVERY_FROM: '4000' });
  t.after(() => shop.close());
  const html = await client(shop.base).text('/delivery');

  for (const part of ['Способы доставки', 'Способы оплаты', 'Как получить заказ', 'Обмен и возврат', 'Частые вопросы', 'Новая почта', 'При получении', 'Переводом по реквизитам']) {
    assert.ok(html.includes(part), `нет блока «${part}»`);
  }
  assert.match(html, /80\s₴/);
  assert.match(html, /200\s₴/);
  assert.match(html, /от\s<strong>4\s000\s₴/);
  assert.match(html, /<details>/);
  assert.match(html, /href="\/contacts#callback"/, 'призыв заказать звонок');

  // без бесплатной доставки блок не показывается
  const off = startShop({ FREE_DELIVERY_FROM: '0' });
  t.after(() => off.close());
  assert.doesNotMatch(await client(off.base).text('/delivery'), /Доставка бесплатная при заказе/);
});

test('конфиг: по умолчанию гривна и часовой пояс Киева; неверный пояс отклоняется', () => {
  const cfg = load({ CURRENCY: '', TIMEZONE: '' });
  assert.equal(cfg.currency, 'UAH');
  assert.equal(cfg.timezone, 'Europe/Kyiv');
  assert.throws(() => load({ TIMEZONE: 'Mars/Olympus' }), /TIMEZONE/);
});

test('конфиг: в боевом режиме без секретов сервер не стартует', () => {
  assert.throws(() => load({ NODE_ENV: 'production', SESSION_SECRET: '', ADMIN_PASSWORD: 'long-enough-pass' }), /SESSION_SECRET/);
  assert.throws(() => load({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'short' }), /ADMIN_PASSWORD/);
  const ok = load({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'long-enough-pass' });
  assert.equal(ok.isProd, true);
});
