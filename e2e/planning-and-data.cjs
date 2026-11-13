// Browser walkthrough of the real app (sql.js driver). Run: npm run build && npm run preview, then: node e2e/planning-and-data.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const S = require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'tempo-e2e-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE ' + m.text()));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${S}/fail2-${name.replace(/\W+/g, '_')}.png` }); } };
  const nav = (n) => page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + n) }).click();
  await page.goto(BASE + '/#/tasks');
  const add = page.getByLabel('Add task', { exact: true });
  for (const t of ['Legal Research', 'English practice']) { await add.fill(t); await add.press('Enter'); await page.getByText(t).first().waitFor(); }

  await step('drag task onto calendar, then conflict on second drop', async () => {
    await nav('Calendar');
    const col = page.locator('div[style*="height: 1152px"].relative.border-s').nth(3);
    await page.getByRole('complementary').getByText('Legal Research').dragTo(col, { targetPosition: { x: 40, y: 10 * 48 + 4 } });
    await page.getByTitle(/Legal Research\n10:00/).waitFor();
    await page.getByRole('complementary').getByText('English practice').dragTo(col, { targetPosition: { x: 40, y: 10 * 48 + 14 } });
    await page.getByText('Scheduling conflict').waitFor();
    await page.getByText('2 overlapping items').waitFor();
    // move one block away to resolve
    await page.getByTitle(/English practice/).dragTo(col, { targetPosition: { x: 40, y: 13 * 48 + 4 } });
    await page.getByText('2 overlapping items').waitFor({ state: 'detached' });
    await page.screenshot({ path: `${S}/11-calendar-dnd.png` });
  });
  await step('habit progress bar fills', async () => {
    await nav('Habits');
    await page.getByRole('button', { name: 'Create a habit' }).click();
    await page.getByPlaceholder('Morning reading').fill('English');
    await page.getByRole('dialog').getByRole('combobox').first().selectOption('duration');
    await page.getByRole('dialog').getByRole('spinbutton').fill('60');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByLabel('Add min for English').fill('45'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('45/60 min').waitFor(); await page.waitForTimeout(500);
    const w = await page.getByRole('main').getByRole('progressbar').first().getAttribute('aria-valuenow');
    if (w !== '75') throw new Error('progress ' + w);
  });
  let exported;
  await step('export JSON, wipe, restore', async () => {
    await nav('Settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything (JSON)' }).click()]);
    exported = `${S}/export.json`; await dl.saveAs(exported);
    const file = JSON.parse(fs.readFileSync(exported, 'utf8'));
    if (file.tables.tasks.length !== 2 || file.tables.habits.length !== 1) throw new Error('export content wrong');
    await nav('Habits');
    await page.getByRole('button', { name: 'Options for English' }).click();
    await page.getByRole('menuitem', { name: 'Delete with history' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByText('No habits yet').waitFor();
    await nav('Settings');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Restore from export…' }).click()]);
    await chooser.setFiles(exported);
    await page.getByRole('button', { name: 'Replace my data' }).click();
    await page.getByText('Data restored').waitFor();
    await nav('Habits');
    await page.getByText('45/60 min').waitFor();
  });
  await step('CSV exports', async () => {
    await nav('Settings');
    const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tasks (CSV)' }).click()]);
    await d1.saveAs(`${S}/tasks.csv`);
    if (!fs.readFileSync(`${S}/tasks.csv`, 'utf8').includes('Legal Research')) throw new Error('csv missing task');
  });
  await step('edit single recurring occurrence only', async () => {
    await nav('My Tasks');
    await add.fill('Daily review'); await add.press('Enter');
    await page.getByText('Daily review').click();
    await page.getByRole('button', { name: 'Make recurring' }).click();
    await page.getByRole('button', { name: 'Create series' }).click();
    await page.getByRole('tab', { name: 'Upcoming' }).click();
    await page.getByText('Daily review').nth(1).click();
    const title = page.getByLabel('Task title'); await title.fill('Daily review (short)'); await title.press('Enter');
    await page.getByText('this occurrence was edited on its own').waitFor();
    const n = await page.getByRole('main').getByText('Daily review', { exact: true }).count();
    if (n < 10) throw new Error('other occurrences changed: ' + n);
  });
  await step('pomodoro completes into break (1-minute session)', async () => {
    await nav('Focus');
    await page.getByRole('main').getByRole('spinbutton').first().fill('1');
    await page.getByRole('button', { name: 'Start pomodoro' }).click();
    await page.getByRole('timer').waitFor();
    await page.getByRole('dialog', { name: 'Session complete' }).waitFor({ timeout: 70000 });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByText('Short break').first().waitFor();
    await page.getByRole('button', { name: 'Skip break' }).click();
    await page.getByRole('tab', { name: 'Time log' }).click();
    await page.getByText('1m', { exact: true }).first().waitFor();
  });
  console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no console errors');
  console.log('screenshots in', S);
  await browser.close();
})();
