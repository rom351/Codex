// Рендер анімації в MP4 (30 кадров/с, 1080x1920, 60 с) покадрово через Chromium + ffmpeg.
//
// Использование (нужен пакет playwright-core и ffmpeg):
//   node render.js video.mp4              — полный ролик
//   node render.js --stills 3,15,25 dir   — отдельные кадры в PNG для проверки
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const DURATION = 60;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const args = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.evaluate(() => document.fonts.ready);

  if (args[0] === '--stills') {
    const times = args[1].split(',').map(Number);
    const dir = args[2] || '.';
    fs.mkdirSync(dir, { recursive: true });
    for (const t of times) {
      await page.evaluate(t => window.renderAt(t), t);
      await page.screenshot({ path: path.join(dir, `t${t}.png`) });
    }
    await browser.close();
    return;
  }

  const out = args[0] || 'video.mp4';
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(res => ff.on('close', res));
  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.renderAt(t), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`кадр ${i}/${total}`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log('готово:', out);
})();
