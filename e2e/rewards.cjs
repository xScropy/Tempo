// Browser walkthrough: levels, tokens, rewards and the dark-mode toggle. Run against `npm run preview`.
const { chromium } = require('playwright');
const os = require('os');
const S = require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'tempo-e2e-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE ' + m.text()));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}.png` }); } };
  const nav = (n) => page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + n) }).click();
  await page.goto(BASE + '/#/tasks');
  await step('completing tasks earns XP, a quest and tokens', async () => {
    const add = page.getByLabel('Add task', { exact: true });
    for (const t of ['One', 'Two', 'Three']) { await add.fill(t); await add.press('Enter'); await page.getByText(t, { exact: true }).waitFor(); }
    for (let i = 0; i < 3; i++) await page.getByRole('main').getByRole('checkbox', { name: 'Mark as done' }).first().click();
    await nav('Rewards');
    await page.getByText('3/3').waitFor();               // "Complete 3 tasks" quest
    await page.getByText('55 XP', { exact: true }).waitFor();     // 45 XP earned (3 × 10 + 15 quest bonus), 55 to go
    await page.getByText('4 earned · 0 spent').waitFor();
  });
  await step('rewards: cannot overspend, can redeem what is affordable', async () => {
    await page.getByLabel('Reward name').fill('Movie night'); await page.getByLabel('Cost in tokens').fill('50'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Need 46' }).waitFor();
    if (!(await page.getByRole('button', { name: 'Need 46' }).isDisabled())) throw new Error('unaffordable reward is clickable');
    await page.getByLabel('Reward name').fill('Coffee break'); await page.getByLabel('Cost in tokens').fill('3'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Redeem' }).click();
    await page.getByRole('button', { name: 'Spend 3 tokens' }).click();
    await page.getByText('4 earned · 3 spent').waitFor();
    await page.getByText('Recently redeemed').waitFor();
  });
  await step('dark mode toggle in the sidebar', async () => {
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.waitForTimeout(300); await page.screenshot({ path: `${S}/rewards-dark.png` });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark')); // persisted
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  });
  await step('feature can be switched off', async () => {
    await nav('Settings');
    await page.getByLabel('Levels, tokens, daily quests and rewards').uncheck();
    await page.getByRole('navigation').getByRole('button', { name: /^Rewards/ }).waitFor({ state: 'detached' });
    await page.getByLabel('Levels, tokens, daily quests and rewards').check();
  });
  console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no console errors');
  console.log('screenshots in', S);
  await browser.close();
})();
