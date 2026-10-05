'use strict';

const crypto = require('node:crypto');

// Без похожих символов (0/O, 1/I)
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newPublicId() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

class OrderError extends Error {}

const MAX_QTY_PER_LINE = 10;

function createOrders(db, config) {
  // Строки корзины из cookie -> актуальные данные из БД
  function resolveCart(cart) {
    const lines = [];
    for (const [rawId, rawQty] of Object.entries(cart || {})) {
      const id = Number.parseInt(rawId, 10);
      const wanted = Number.parseInt(rawQty, 10);
      if (!Number.isInteger(id) || !(wanted > 0)) continue;
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
      if (!product || product.stock < 1) continue;
      const qty = Math.min(wanted, product.stock, MAX_QTY_PER_LINE);
      lines.push({ product, qty, sum: product.price * qty, limited: qty < wanted });
    }
    const subtotal = lines.reduce((s, l) => s + l.sum, 0);
    const count = lines.reduce((s, l) => s + l.qty, 0);
    return { lines, subtotal, count };
  }

  function deliveryCost(method, subtotal) {
    if (method === 'pickup') return 0;
    if (config.delivery.freeFrom > 0 && subtotal >= config.delivery.freeFrom) return 0;
    return method === 'courier' ? config.delivery.courierFee : config.delivery.postFee;
  }

  // Создаёт заказ и списывает остатки в одной транзакции
  const place = db.transaction((form, cart) => {
    const resolved = resolveCart(cart);
    if (resolved.lines.length === 0) throw new OrderError('Корзина пуста.');

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)',
    );
    const takeStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

    const delivery = deliveryCost(form.delivery_method, resolved.subtotal);
    const total = resolved.subtotal + delivery;

    let publicId;
    do {
      publicId = newPublicId();
    } while (db.prepare('SELECT 1 FROM orders WHERE public_id = ?').get(publicId));

    const info = db
      .prepare(
        `INSERT INTO orders
           (public_id, customer_name, phone, email, delivery_method, address, payment_method, comment,
            subtotal, delivery_cost, total)
         VALUES (@public_id, @customer_name, @phone, @email, @delivery_method, @address, @payment_method, @comment,
                 @subtotal, @delivery_cost, @total)`,
      )
      .run({ ...form, public_id: publicId, subtotal: resolved.subtotal, delivery_cost: delivery, total });
    const orderId = Number(info.lastInsertRowid);

    for (const { product, qty } of resolved.lines) {
      if (takeStock.run(qty, product.id, qty).changes === 0) {
        throw new OrderError(`Товара «${product.name}» уже недостаточно на складе. Обновите корзину.`);
      }
      insertItem.run(orderId, product.id, `${product.brand} ${product.name}`, product.price, qty);
    }
    return { id: orderId, publicId, total };
  });

  const byPublicId = (publicId) => {
    const order = db.prepare('SELECT * FROM orders WHERE public_id = ?').get(publicId);
    if (!order) return null;
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return order;
  };

  const byId = (id) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return null;
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return order;
  };

  const adminList = (status) =>
    status
      ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all();

  const counts = () => {
    const out = { new: 0, confirmed: 0, shipped: 0, done: 0, cancelled: 0 };
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) out[r.status] = r.n;
    return out;
  };

  // Смена статуса. Отмена возвращает товар на склад, возврат из отмены снова списывает.
  const setStatus = db.transaction((id, status) => {
    const order = byId(id);
    if (!order) throw new OrderError('Заказ не найден.');
    if (order.status === status) return;

    const wasCancelled = order.status === 'cancelled';
    const willBeCancelled = status === 'cancelled';

    if (!wasCancelled && willBeCancelled) {
      for (const it of order.items) {
        if (it.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
      }
    } else if (wasCancelled && !willBeCancelled) {
      for (const it of order.items) {
        if (!it.product_id) continue;
        const ok = db
          .prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
          .run(it.qty, it.product_id, it.qty).changes;
        if (!ok) throw new OrderError(`Нельзя вернуть заказ: «${it.name}» нет в наличии в нужном количестве.`);
      }
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  });

  return { resolveCart, deliveryCost, place, byPublicId, byId, adminList, counts, setStatus };
}

module.exports = { createOrders, OrderError, MAX_QTY_PER_LINE };
