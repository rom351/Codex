'use strict';

const { load } = require('./config');
const { createApp } = require('./app');

const config = load();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`Магазин «${config.shop.name}» запущен: ${config.siteUrl} (порт ${config.port})`);
  if (!config.isProd) console.log('Режим разработки. Админ-панель: /admin, пароль по умолчанию: admin');
});

function shutdown() {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
