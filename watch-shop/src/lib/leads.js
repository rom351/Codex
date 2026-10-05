'use strict';

const { phoneKey } = require('./phones');

function createLeads(db) {
  const create = (data) =>
    Number(
      db
        .prepare(
          `INSERT INTO leads (kind, name, phone, email, message, source)
           VALUES (@kind, @name, @phone, @email, @message, @source)`,
        )
        .run(data).lastInsertRowid,
    );

  const list = (status) =>
    status
      ? db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT 300').all(status)
      : db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 300').all();

  const byId = (id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id);

  const counts = () => {
    const out = { new: 0, in_progress: 0, done: 0, spam: 0 };
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all()) out[r.status] = r.n;
    return out;
  };

  const update = (id, { status, note }) =>
    db.prepare('UPDATE leads SET status = ?, note = ? WHERE id = ?').run(status, note, id);

  // Всё, что известно об одном клиенте: заказы и заявки с тем же телефоном
  function related(phone, { exceptOrderId = null, exceptLeadId = null } = {}) {
    const key = phoneKey(phone);
    if (key.length < 9) return { orders: [], leads: [] };
    const orders = db
      .prepare('SELECT id, public_id, status, total, created_at, phone FROM orders ORDER BY id DESC LIMIT 2000')
      .all()
      .filter((o) => o.id !== exceptOrderId && phoneKey(o.phone) === key);
    const leads = db
      .prepare('SELECT id, kind, status, message, created_at, phone FROM leads ORDER BY id DESC LIMIT 2000')
      .all()
      .filter((l) => l.id !== exceptLeadId && phoneKey(l.phone) === key);
    return { orders, leads };
  }

  return { create, list, byId, counts, update, related };
}

module.exports = { createLeads };
