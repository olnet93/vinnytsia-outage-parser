import playwright from 'playwright';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REGIONS } from './regions.js';
import { 
  mapStateValue, 
  getTimestampForDate, 
  ensureDataDir,
  getCurrentAndTomorrowDates 
} from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function parseDisconnectionData(region) {
  console.log(`🔍 Починаю парсинг: ${region.name}`);

  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-gpu']
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    console.log(`  → Завантажую сторінку...`);
    await page.goto('https://www.voe.com.ua/disconnection/detailed', {
      waitUntil: 'networkidle'
    });

    if (region.selector) {
      console.log(`  → Вибираю регіон...`);
      await page.click(region.selector);
      await page.waitForTimeout(2000);
    }

    console.log(`  → Очікую таблицю...`);
    await page.waitForSelector('table.disconnection-detailed-table', {
      timeout: 10000
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const data = parseTable($);

    const timestamp = new Date().toISOString();
    const output = {
      regionId: region.id,
      lastUpdated: timestamp,
      fact: {
        data: data,
        updateFact: new Date().toLocaleString('uk-UA')
      },
      lastUpdateStatus: {
        status: 'parsed',
        ok: true,
        code: 200,
        message: null,
        at: timestamp,
        attempt: 1
      },
      meta: {
        schemaVersion: '1.0.0',
        contentHash: generateHash(JSON.stringify(data))
      },
      regionAffiliation: region.name
    };

    const dataDir = path.join(__dirname, '..', 'data');
    ensureDataDir(dataDir);

    const filePath = path.join(dataDir, `${region.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`✅ Готово: ${region.name}`);
    console.log(`   📁 ${filePath}`);
    console.log(`   📅 Оновлено: ${output.fact.updateFact}\n`);

    await context.close();
    return true;

  } catch (error) {
    console.error(`❌ Помилка при парсингу ${region.name}:`, error.message);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

function parseTable($) {
  const data = {};
  const { today, tomorrow } = getCurrentAndTomorrowDates();

  const rows = $('table.disconnection-detailed-table tbody tr');

  if (rows.length === 0) {
    throw new Error('Таблиця не знайдена або порожня');
  }

  const currentDayRow = $(rows[0]);
  const nextDayRow = $(rows[1]);

  const currentDayData = parseRow(currentDayRow, $, 'current_day');
  data[getTimestampForDate(today)] = currentDayData;

  const nextDayData = parseRow(nextDayRow, $, 'other_day');
  data[getTimestampForDate(tomorrow)] = nextDayData;

  return data;
}

function parseRow(row, $, dayClass) {
  const queues = {};

  const cells = row.find(`td div.disconnection-detailed-table-cell.cell.${dayClass}`);

  let hourIndex = 1;
  cells.each((index, cell) => {
    const $cell = $(cell);
    const queueName = $cell.data('queue') || `Queue_${index}`;

    const state = determineState($cell, $);
    queues[queueName] = state;

    hourIndex++;
  });

  return queues;
}

function determineState($cell, $) {
  const hasDisconnection = $cell.hasClass('has_disconnection');
  const isFullHour = $cell.hasClass('full_hour');
  const isConfirm1 = $cell.hasClass('confirm_1');
  const isConfirm0 = $cell.hasClass('confirm_0');

  if (!hasDisconnection) {
    return 'yes';
  }

  if (isFullHour) {
    if (isConfirm1) return 'no';
    if (isConfirm0) return 'maybe';
  }

  const leftHalf = $cell.find('.half.left');
  const rightHalf = $cell.find('.half.right');

  const leftHasDisconnection = leftHalf.hasClass('has_disconnection');
  const rightHasDisconnection = rightHalf.hasClass('has_disconnection');

  if (leftHasDisconnection && rightHasDisconnection) {
    return isConfirm1 ? 'no' : 'maybe';
  }

  if (leftHasDisconnection) {
    return isConfirm1 ? 'first' : 'maybe_first';
  }

  if (rightHasDisconnection) {
    return isConfirm1 ? 'second' : 'maybe_second';
  }

  return 'yes';
}

function generateHash(str) {
  const crypto = require('crypto');
  return crypto
    .createHash('sha256')
    .update(str)
    .digest('hex');
}

async function main() {
  const arg = process.argv[2] || 'vinnytsia';

  console.log('═══════════════════════════════════════════════════');
  console.log('  🔌 Парсер графіків відключення світла Вінниці');
  console.log('═══════════════════════════════════════════════════\n');

  const region = REGIONS.find(r => r.id === arg);
  if (!region) {
    console.error(`❌ Регіон не знайдений: ${arg}`);
    process.exit(1);
  }

  const success = await parseDisconnectionData(region);

  console.log('═══════════════════════════════════════════════════');
  console.log(success ? '✅ Успішно завершено' : '❌ Помилка при виконанні');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(console.error);