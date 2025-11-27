import playwright from 'playwright';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REGIONS } from './regions.js';
import { 
  getTimestampForDate, 
  ensureDataDir,
  getCurrentAndTomorrowDates 
} from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function parseDisconnectionData(region) {
  console.log(`🔍 Починаю парсинг: ${region.name}`);
  
  let browser;
  let page;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    
    page = await browser.newPage();
    
    // Встановити реальний User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Встановити заголовки для обходу Cloudflare
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'uk-UA,uk;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://www.voe.com.ua/',
      'Origin': 'https://www.voe.com.ua',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // Встановити User-Agent щоб виглядати як звичайний браузер
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['uk-UA', 'uk'],
      });
    });
    
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    
    console.log(`  → Завантажую сторінку...`);
    const response = await page.goto('https://www.voe.com.ua/disconnection/detailed', {
      waitUntil: 'domcontentloaded'
    });
    
    console.log(`  → Статус: ${response.status()}`);
    
    if (response.status() === 403) {
      console.log(`  ⚠️  Статус 403! Чекаю Cloudflare...`);
      await page.waitForTimeout(5000);
    }
    
    // Чекаємо додатковий час для JS завантаження
    await page.waitForTimeout(3000);
    
    // Перевіримо селектор таблиці
    const tableExists = await page.evaluate(() => {
      return document.querySelector('table.disconnection-detailed-table') !== null;
    });
    
    console.log(`  → Таблиця існує: ${tableExists}`);
    
    if (!tableExists) {
      console.log(`  ⚠️  Таблиця не знайдена! Переглядаю вміст...`);
      
      // Спробуємо знайти альтернативні селектори
      const allTables = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table')).map((t, i) => ({
          index: i,
          classes: t.className,
          rows: t.querySelectorAll('tr').length
        }));
      });
      
      console.log(`  → Знайдено таблиць: ${allTables.length}`);
      allTables.forEach(t => {
        console.log(`    [${t.index}] класи: ${t.classes}, рядків: ${t.rows}`);
      });
      
      // Перевіримо чи є таблиця на сторінці взагалі
      const pageTitle = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log(`  → Заголовок сторінки: ${pageTitle}`);
      console.log(`  → Перші 200 символів: ${bodyText.substring(0, 200)}`);
      
      throw new Error('Таблиця не знайдена на сторінці');
    }
    
    if (region.selector) {
      console.log(`  → Вибираю регіон: ${region.selector}`);
      try {
        const regionExists = await page.evaluate((sel) => {
          return document.querySelector(sel) !== null;
        }, region.selector);
        
        if (regionExists) {
          await page.click(region.selector);
          await page.waitForTimeout(2000);
          console.log(`  ✓ Регіон вибраний`);
        } else {
          console.log(`  ⚠️  Селектор регіону не знайдений: ${region.selector}`);
        }
      } catch (e) {
        console.log(`  ⚠️  Помилка при виборі регіону: ${e.message}`);
      }
    }
    
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
    
    return true;
    
  } catch (error) {
    console.error(`❌ Помилка при парсингу ${region.name}:`, error.message);
    console.error(`   Stack:`, error.stack.split('\n').slice(0, 3).join('\n'));
    return false;
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

function parseTable($) {
  const data = {};
  const { today, tomorrow } = getCurrentAndTomorrowDates();
  
  const rows = $('table.disconnection-detailed-table tbody tr');
  
  console.log(`  → Рядків в таблиці: ${rows.length}`);
  
  if (rows.length === 0) {
    throw new Error('Таблиця знайдена, але рядків немає');
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
