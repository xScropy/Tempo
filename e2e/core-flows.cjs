// Browser walkthrough of the real app (sql.js driver). Run: npm run build && npm run preview, then: node e2e/core-flows.cjs
const { chromium } = require('playwright');
const os = require('os');
const S = require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'tempo-e2e-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000); const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE ' + m.text()));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}.png` }); } };
  await page.goto(BASE + '/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const nav = (n) => page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + n) }).click();

  await step('create project', async () => {
    await nav('Projects');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByPlaceholder('Prepare for International Moot Court').fill('Moot Court');
    await page.getByPlaceholder('e.g. 100h').fill('100h');
    await page.getByPlaceholder('e.g. 12h').fill('10h');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByText('No tasks yet').waitFor();
  });
  await step('add tasks to project', async () => {
    const add = page.getByLabel('Add task to project');
    for (const t of ['Research Article 17 ICCPR', 'Analyze ECtHR judgments', 'Prepare case-law summary']) { await add.fill(t); await add.press('Enter'); await page.getByText(t).first().waitFor(); }
  });
  await step('task detail + subtasks + estimate', async () => {
    await page.getByText('Analyze ECtHR judgments').click();
    await page.getByLabel('Add subtask').fill('Read case A'); await page.getByLabel('Add subtask').press('Enter');
    await page.getByLabel('Add subtask').fill('Read case B'); await page.getByLabel('Add subtask').press('Enter');
    await page.getByText('Read case B').first().waitFor();
    const est = page.getByLabel('Task details').getByPlaceholder('e.g. 1h 30m'); await est.fill('2h'); await est.press('Enter');
    await page.getByLabel('Task details').getByText('of 2h estimated').waitFor();
    await page.getByLabel('Task details').getByRole('checkbox', { name: 'Mark as done' }).nth(1).click(); // first subtask
    await page.getByText('1/2').first().waitFor();
    await page.screenshot({ path: `${S}/01-project.png` });
    await page.getByRole('button', { name: 'Close panel' }).click();
  });
  await step('progress reflects subtask', async () => { await page.getByText('17%').first().waitFor({ timeout: 3000 }); });
  await step('quick add with parsing', async () => {
    await page.keyboard.press('n');
    await page.getByLabel('Task', { exact: true }).fill('Study International Humanitarian Law for 2 hours tomorrow !high #law');
    await page.getByText('Tomorrow').first().waitFor();
    await page.getByRole('button', { name: 'Add task' }).click();
    await nav('My Tasks');
    await page.getByRole('tab', { name: 'Upcoming' }).click();
    await page.getByText('Study International Humanitarian Law').waitFor();
  });
  await step('recurring task', async () => {
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.getByLabel('Add task', { exact: true }).fill('Morning reading'); await page.getByLabel('Add task', { exact: true }).press('Enter');
    await page.getByText('Morning reading').click();
    await page.getByRole('button', { name: 'Make recurring' }).click();
    await page.getByRole('button', { name: 'Create series' }).click();
    await page.getByRole('tab', { name: 'Upcoming' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('div')].filter((d) => d.textContent === 'Morning reading').length >= 10);
  });
  await step('board + matrix + timeline render', async () => {
    await page.getByRole('tab', { name: 'All', exact: true }).click();
    for (const t of ['Kanban board', 'By priority', 'Eisenhower matrix', 'Timeline', 'List']) { await page.getByTitle(t).click(); await page.waitForTimeout(150); }
    await page.getByTitle('Kanban board').click(); await page.screenshot({ path: `${S}/02-board.png` }); await page.getByTitle('List').click();
  });
  await step('focus: stopwatch on task, survives reload', async () => {
    await nav('Focus');
    await page.getByRole('tab', { name: 'Stopwatch' }).click();
    await page.getByText('No task — quick focus').click();
    await page.getByLabel('Search tasks').fill('Research');
    await page.getByRole('button', { name: /Research Article 17/ }).click();
    await page.getByRole('button', { name: 'Start stopwatch' }).click();
    await page.getByRole('timer').waitFor();
    await page.waitForTimeout(2500);
    await page.reload();
    await page.getByRole('timer').waitFor();
    const t = await page.getByRole('timer').textContent();
    if (!/00:0[2-9]/.test(t)) throw new Error('timer after reload shows ' + t);
    await page.screenshot({ path: `${S}/03-focus.png` });
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByText('What did you accomplish during this session?').waitFor();
    await page.getByRole('dialog').locator('textarea').fill('Read the commentary on Article 17');
    await page.getByRole('button', { name: 'Save' }).click();
  });
  await step('manual time entry + time log', async () => {
    await page.getByRole('tab', { name: 'Time log' }).click();
    await page.getByRole('button', { name: 'Add time' }).click();
    await page.getByRole('dialog').locator('input[type=time]').fill('00:05'); await page.getByPlaceholder('45m').fill('45m'); await page.getByPlaceholder('45m').press('Tab');
    await page.getByPlaceholder(/I spent 45 minutes/).fill('Reading a judgment');
    await page.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Reading a judgment').waitFor();
    await page.getByText('Read the commentary on Article 17').waitFor();
    await page.screenshot({ path: `${S}/04-timelog.png` });
  });
  await step('calendar: event + conflict', async () => {
    await nav('Calendar');
    for (const title of ['Project Meeting', 'Clashing call']) {
      await page.getByRole('button', { name: 'Event' }).click();
      await page.getByRole('dialog').getByRole('textbox').first().fill(title);
      await page.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    await page.getByText('2 overlapping items').waitFor();
    await page.screenshot({ path: `${S}/05-calendar.png` });
    for (const v of ['Month', 'Agenda', 'Day', 'Week']) { await page.getByRole('tab', { name: v }).click(); await page.waitForTimeout(150); }
  });
  await step('habits', async () => {
    await nav('Habits');
    await page.getByRole('button', { name: 'Create a habit' }).click();
    await page.getByPlaceholder('Morning reading').fill('Daily prayers');
    await page.getByRole('dialog').getByRole('combobox').first().selectOption('sessions');
    await page.getByRole('dialog').getByRole('spinbutton').fill('5');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Check in' }).click();
    await page.getByText('5/5').waitFor();
    await page.getByText('1 day streak').waitFor().catch(() => { throw new Error('streak not 1'); });
    await page.screenshot({ path: `${S}/06-habits.png` });
  });
  await step('goals + weekly target', async () => {
    await nav('Goals');
    await page.getByText('Moot Court').first().waitFor();
    await page.getByRole('button', { name: 'Weekly target' }).click();
    await page.getByPlaceholder('English learning').fill('English'); await page.getByPlaceholder('e.g. 5h').fill('5h'); await page.getByPlaceholder('e.g. 5h').press('Tab');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByText('English').first().waitFor();
    await page.screenshot({ path: `${S}/07-goals.png` });
  });
  await step('analytics', async () => { await nav('Analytics'); await page.getByText('Where the time went').waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${S}/08-analytics.png`, fullPage: false }); });
  await step('journal', async () => { await nav('Journal'); const t = page.locator('textarea').first(); await t.fill('Finished the **Article 17** research'); await t.blur(); await page.getByText(/Last saved/).waitFor(); });
  await step('search', async () => { await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Search' }).getByRole('textbox').fill('article 17'); await page.getByText('Research Article 17 ICCPR').first().waitFor(); await page.getByText(/Journal ·/).waitFor(); await page.keyboard.press('Escape'); });
  await step('friends + settings', async () => { await nav('Friends'); await page.getByText('Your weekly summary').waitFor(); await nav('Settings'); await page.getByRole('tab', { name: 'Dark' }).click(); await page.waitForTimeout(200); });
  await step('dashboard (dark)', async () => { await nav('Dashboard'); await page.getByText('Priority tasks').waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${S}/09-dashboard-dark.png` }); await nav('Settings'); await page.getByRole('tab', { name: 'Light' }).click(); await nav('Dashboard'); await page.waitForTimeout(300); await page.screenshot({ path: `${S}/10-dashboard.png` }); });
  await step('persistence across reload', async () => { await page.waitForTimeout(400); await page.reload(); await nav('Projects'); await page.getByText('Moot Court').first().waitFor(); });
  console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no console errors');
  console.log('screenshots in', S);
  await browser.close();
})();
