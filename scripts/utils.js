import fs from 'fs';
import path from 'path';

export function mapStateValue(state) {
  const stateMap = {
    'yes': 'yes',
    'no': 'no',
    'first': 'first',
    'second': 'second',
    'maybe': 'maybe',
    'maybe_first': 'maybe',
    'maybe_second': 'maybe'
  };

  return stateMap[state] || state;
}

export function getTimestampForDate(date) {
  return Math.floor(date.getTime() / 1000).toString();
}

export function getCurrentAndTomorrowDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return { today, tomorrow };
}

export function ensureDataDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getTimeFromHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseHourFromHtml(htmlElement) {
  const text = htmlElement.textContent || '';
  const match = text.match(/(\d{1,2})/);
  return match ? parseInt(match[1]) : null;
}