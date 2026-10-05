'use strict';

const express = require('express');
const { GENDERS, MOVEMENTS, parseMoney } = require('../lib/format');
const { SORTS } = require('../lib/products');

function one(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Параметры каталога из строки запроса -> проверенные фильтры
function parseFilters(query) {
  const f = {};
  const q = one(query.q).slice(0, 60);
  if (q) f.q = q;
  if (GENDERS[one(query.gender)]) f.gender = one(query.gender);
  if (MOVEMENTS[one(query.movement)]) f.movement = one(query.movement);
  const brand = one(query.brand).slice(0, 60);
  if (brand) f.brand = brand;
  const min = parseMoney(one(query.min));
  const max = parseMoney(one(query.max));
  if (min !== null) f.minPrice = min;
  if (max !== null) f.maxPrice = max;
  if (one(query.stock) === '1') f.inStock = true;
  if (SORTS[one(query.sort)]) f.sort = one(query.sort);
  const page = Number.parseInt(one(query.page), 10);
  if (page > 0) f.page = page;
  return f;
}

function queryString(filters, overrides = {}) {
  const src = { ...filters, ...overrides };
  const params = new URLSearchParams();
  const map = {
    q: src.q, gender: src.gender, movement: src.movement, brand: src.brand,
    min: src.minPrice != null ? src.minPrice / 100 : '',
    max: src.maxPrice != null ? src.maxPrice / 100 : '',
    stock: src.inStock ? '1' : '', sort: src.sort, page: src.page > 1 ? src.page : '',
  };
  for (const [k, v] of Object.entries(map)) if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

module.exports = function shopRoutes({ config, products }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const latest = products.list({ limit: 4, sort: 'new' }).items;
    // Показываем ровные ряды по 4 карточки (но не меньше одного ряда)
    const picked = products.list({ featured: true, limit: 8, sort: 'new' }).items;
    const featured = picked.length >= 4 ? picked.slice(0, Math.floor(picked.length / 4) * 4) : latest;
    res.render('home', {
      featured,
      meta: {
        title: `${config.shop.name} — ${config.shop.slogan}`,
        description: `${config.shop.name}: интернет-магазин часов. Мужские, женские и умные часы с доставкой.`,
        canonical: `${config.siteUrl}/`,
      },
    });
  });

  router.get('/catalog', (req, res) => {
    const filters = parseFilters(req.query);
    const result = products.list(filters);
    // Страницы с поиском и тонкими фильтрами в поисковую выдачу не нужны
    const deepFilter =
      filters.q || filters.brand || filters.minPrice != null || filters.maxPrice != null || filters.inStock || filters.sort;
    const heading = filters.q
      ? `Поиск: «${filters.q}»`
      : filters.gender
        ? `${GENDERS[filters.gender]} часы`
        : filters.movement
          ? `${MOVEMENTS[filters.movement]} часы`
          : 'Каталог часов';
    res.render('catalog', {
      heading,
      filters,
      result,
      brands: products.brands(),
      GENDERS,
      MOVEMENTS,
      SORTS,
      qs: (overrides) => queryString(filters, overrides),
      meta: {
        title: `${heading} — ${config.shop.name}`,
        description: `${heading} в магазине ${config.shop.name}. Цены, наличие и доставка.`,
        canonical: `${config.siteUrl}/catalog${queryString({ ...filters, page: 1, sort: undefined })}`,
        robots: deepFilter ? 'noindex,follow' : null,
      },
    });
  });

  router.get('/watch/:slug', (req, res, next) => {
    const product = products.bySlug(req.params.slug);
    if (!product) return next();
    let specs = [];
    try {
      specs = JSON.parse(product.specs);
    } catch {
      /* пустые характеристики */
    }
    const image = `${config.siteUrl}${product.image ? `/uploads/${product.image}` : `/img/p/${product.slug}.svg`}`;
    const ldJson = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${product.brand} ${product.name}`,
      brand: { '@type': 'Brand', name: product.brand },
      description: product.description,
      image,
      offers: {
        '@type': 'Offer',
        url: `${config.siteUrl}/watch/${product.slug}`,
        priceCurrency: config.currency,
        price: (product.price / 100).toFixed(2),
        availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    }).replace(/</g, '\\u003c');

    res.render('product', {
      product,
      specs,
      related: products.related(product),
      maxQty: Math.min(product.stock, 10),
      ldJson,
      added: req.query.added === '1',
      meta: {
        title: `${product.brand} ${product.name} — купить в ${config.shop.name}`,
        description: product.description.slice(0, 160),
        canonical: `${config.siteUrl}/watch/${product.slug}`,
        image,
      },
    });
  });

  // ----- Информационные страницы -----

  const freeFrom = config.delivery.freeFrom;
  const pages = {
    delivery: { title: 'Доставка и оплата', view: 'page-delivery' },
    about: { title: 'О магазине', view: 'page-about' },
    privacy: { title: 'Политика конфиденциальности', view: 'page-privacy' },
  };
  for (const [slug, page] of Object.entries(pages)) {
    router.get(`/${slug}`, (req, res) => {
      res.render(page.view, {
        title: page.title,
        courierFee: config.delivery.courierFee,
        postFee: config.delivery.postFee,
        freeFrom,
        meta: {
          title: `${page.title} — ${config.shop.name}`,
          description: `${page.title} — ${config.shop.name}`,
          canonical: `${config.siteUrl}/${slug}`,
        },
      });
    });
  }

  // ----- SEO -----

  router.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .send(`User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });

  router.get('/sitemap.xml', (req, res) => {
    const urls = ['/', '/catalog', '/catalog?gender=men', '/catalog?gender=women', '/delivery', '/about', '/contacts'];
    const items = products.list({ limit: 1000 }).items;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      [...urls, ...items.map((p) => `/watch/${p.slug}`)]
        .map((u) => `  <url><loc>${esc(config.siteUrl + u)}</loc></url>`)
        .join('\n') +
      '\n</urlset>\n';
    res.type('application/xml').send(xml);
  });

  return router;
};
