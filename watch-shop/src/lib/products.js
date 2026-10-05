'use strict';

const { slugify } = require('./format');

const PAGE_SIZE = 12;

const SORTS = {
  new: { label: 'Сначала новые', sql: 'p.id DESC' },
  price_asc: { label: 'Дешевле', sql: 'p.price ASC, p.id DESC' },
  price_desc: { label: 'Дороже', sql: 'p.price DESC, p.id DESC' },
  name: { label: 'По названию', sql: 'lower_u(p.name) ASC' },
};

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function createProducts(db) {
  function list(filters = {}) {
    const where = ['p.is_active = 1'];
    const params = [];

    if (filters.q) {
      where.push("lower_u(p.name || ' ' || p.brand) LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(filters.q.toLowerCase())}%`);
    }
    if (filters.gender) {
      where.push('p.gender = ?');
      params.push(filters.gender);
    }
    if (filters.movement) {
      where.push('p.movement = ?');
      params.push(filters.movement);
    }
    if (filters.brand) {
      where.push('p.brand = ?');
      params.push(filters.brand);
    }
    if (filters.minPrice != null) {
      where.push('p.price >= ?');
      params.push(filters.minPrice);
    }
    if (filters.maxPrice != null) {
      where.push('p.price <= ?');
      params.push(filters.maxPrice);
    }
    if (filters.inStock) where.push('p.stock > 0');
    if (filters.featured) where.push('p.is_featured = 1');

    const sort = SORTS[filters.sort] || SORTS.new;
    const whereSql = where.join(' AND ');

    const limit = filters.limit || PAGE_SIZE;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`).get(...params).n;
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(1, filters.page || 1), pages);

    const items = db
      .prepare(`SELECT p.* FROM products p WHERE ${whereSql} ORDER BY ${sort.sql} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);

    return { items, total, page, pages };
  }

  const brands = () =>
    db.prepare('SELECT DISTINCT brand FROM products WHERE is_active = 1 ORDER BY brand').all().map((r) => r.brand);

  const bySlug = (slug) => db.prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1').get(slug);
  const byId = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

  function related(product, limit = 4) {
    return db
      .prepare(
        `SELECT * FROM products
         WHERE is_active = 1 AND id != ? AND (brand = ? OR gender = ?)
         ORDER BY (brand = ?) DESC, id DESC LIMIT ?`,
      )
      .all(product.id, product.brand, product.gender, product.brand, limit);
  }

  // ----- Для админ-панели -----

  const adminList = () => db.prepare('SELECT * FROM products ORDER BY id DESC').all();

  function uniqueSlug(base, ignoreId = null) {
    const root = slugify(base) || 'chasy';
    let slug = root;
    for (let i = 2; ; i++) {
      const row = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
      if (!row || row.id === ignoreId) return slug;
      slug = `${root}-${i}`;
    }
  }

  function create(data) {
    const slug = uniqueSlug(`${data.brand} ${data.name}`);
    const info = db
      .prepare(
        `INSERT INTO products
           (slug, name, brand, gender, movement, price, old_price, stock, description, specs, image, is_active, is_featured)
         VALUES (@slug, @name, @brand, @gender, @movement, @price, @old_price, @stock, @description, @specs, @image, @is_active, @is_featured)`,
      )
      .run({ ...data, slug });
    return Number(info.lastInsertRowid);
  }

  function update(id, data) {
    db.prepare(
      `UPDATE products SET
         name = @name, brand = @brand, gender = @gender, movement = @movement,
         price = @price, old_price = @old_price, stock = @stock,
         description = @description, specs = @specs, image = @image,
         is_active = @is_active, is_featured = @is_featured
       WHERE id = @id`,
    ).run({ ...data, id });
  }

  function remove(id) {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  return { list, brands, bySlug, byId, related, adminList, create, update, remove };
}

module.exports = { createProducts, PAGE_SIZE, SORTS };
