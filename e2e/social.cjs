// Two real users, two browsers, one real social server.
// Run:  npm run build && npm run preview &   npm run build:server
//       node e2e/social.cjs      (starts its own server on a spare port)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-social-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';
const PORT = 47899;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let server = spawn('node', ['server/dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: S }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errors = [];
  const user = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
    await page.goto(BASE + '/#/friends');
    return page;
  };
  let current;
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); for (const [n, p] of Object.entries(current)) await p.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}-${n}.png` }).catch(() => {}); } };
  const A = await user('youssef');
  const B = await user('ahmed');
  current = { A, B };
  const tab = (p, t) => p.getByRole('tab', { name: new RegExp('^' + t) }).click();
  const nav = (p, n) => p.getByRole('navigation').getByRole('button', { name: new RegExp('^' + n) }).click();

  await step('1 both create a social profile', async () => {
    for (const [p, u, d] of [[A, 'youssef', 'Youssef'], [B, 'ahmed', 'Ahmed']]) {
      await p.getByPlaceholder(/ws:\/\/192/).fill(`ws://localhost:${PORT}`);
      await p.getByPlaceholder('youssef', { exact: true }).fill(u);
      await p.getByPlaceholder('Youssef', { exact: true }).fill(d);
      await p.getByRole('button', { name: 'Create profile and connect' }).click();
      await p.getByText('Friends online').waitFor();
    }
  });
  await step('2 add by username and accept', async () => {
    await A.getByLabel('Search by username').fill('ahm');
    await A.getByRole('button', { name: 'Add', exact: true }).click();
    await B.getByRole('button', { name: 'Accept' }).click();          // arrives without a refresh
    await A.getByText('@ahmed').first().waitFor();
    await B.getByText('@youssef').first().waitFor();
  });
  await step('3 friends see each other online', async () => {
    await A.getByRole('main').getByText('Online').first().waitFor();
  });
  await step('4+5 focusing status with remaining time, live', async () => {
    await nav(B, 'My Tasks');
    const add = B.getByLabel('Add task', { exact: true });
    await add.fill('Secret thesis chapter'); await add.press('Enter');
    await B.getByText('Secret thesis chapter').click();
    await B.getByLabel('Task details').getByRole('button', { name: 'Focus', exact: true }).click();  // Pomodoro on that task
    await A.getByText('Focusing').first().waitFor();
    await A.getByText(/25-minute pomodoro · 00:0\d elapsed · 2\d:\d\d left/).waitFor();
    await A.screenshot({ path: `${S}/1-friend-focusing.png` });
  });
  await step('13 sharing can be switched off: session time, then activity', async () => {
    await nav(B, 'Social'); await tab(B, 'Profile');
    await B.getByLabel(/Current session time/).click();
    await A.getByText(/elapsed/).waitFor({ state: 'detached' });
    const focusing = A.locator('span.font-medium', { hasText: /^Focusing$/ });  // the status label, not the filter option
    await focusing.first().waitFor();
    await B.getByLabel(/Current activity/).click();
    await focusing.waitFor({ state: 'detached' });
    await A.getByRole('main').getByText('Online').first().waitFor();
    await B.getByLabel(/Current activity/).click();
    await B.getByLabel(/Current session time/).click();
    await A.getByText(/left/).first().waitFor();
  });
  await step('6+7 weekly hours appear and the leaderboard ranks them', async () => {
    await nav(B, 'Focus');
    await B.getByRole('button', { name: 'Stop', exact: true }).first().click();
    await B.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => {});
    await B.getByRole('tab', { name: 'Time log' }).click();
    await B.getByRole('button', { name: 'Add time' }).click();
    await B.getByRole('dialog').locator('input[type=time]').fill('00:05');
    await B.getByPlaceholder('45m').fill('45m'); await B.getByPlaceholder('45m').press('Tab');
    await B.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
    await A.getByText('45m').first().waitFor();                          // pushed to the friend
    await tab(A, 'Leaderboard');
    const first = A.getByRole('main').locator('div.border-b').filter({ hasText: '@ahmed' }).first();
    await first.getByText('1', { exact: true }).waitFor();
    await A.screenshot({ path: `${S}/2-leaderboard.png` });
  });
  await step('8-11 private challenge: invite, join, live standings, leave', async () => {
    await tab(A, 'Challenges');
    await A.getByRole('button', { name: 'New challenge' }).click();
    await A.getByRole('dialog').getByLabel('What counts').selectOption('all');
    await A.getByRole('dialog').getByRole('button', { name: /Ahmed/ }).click();
    await A.getByRole('button', { name: 'Create challenge' }).click();
    await A.getByText('Most focus hours this week').first().waitFor();
    await nav(B, 'Social'); await tab(B, 'Challenges');
    await B.getByRole('button', { name: 'Join' }).click();
    // Ahmed now tracks 30 more minutes; both screens update on their own
    await nav(B, 'Focus'); await B.getByRole('tab', { name: 'Time log' }).click();
    await B.getByRole('button', { name: 'Add time' }).click();
    await B.getByRole('dialog').locator('input[type=time]').fill('00:05');
    await B.getByRole('dialog').locator('input[type=date]').fill(new Date().toLocaleDateString('sv'));
    await B.getByPlaceholder('45m').fill('10m'); await B.getByPlaceholder('45m').press('Tab');
    await B.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
    await B.getByRole('dialog').waitFor({ state: 'detached' });
    await A.getByRole('main').getByText('Ahmed', { exact: true }).waitFor();
    await A.screenshot({ path: `${S}/3-challenge.png` });
    const rows = await A.getByRole('main').locator('div.flex.items-center.gap-3.px-3').allInnerTexts();
    if (!/^1\s*\n?.*Ahmed/s.test(rows[0] || '')) throw new Error('Ahmed is not ranked first: ' + JSON.stringify(rows));
    await nav(B, 'Social'); await tab(B, 'Challenges');
    await B.getByRole('button', { name: 'Leave' }).click();
    await B.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
    await B.getByText('No challenges running').waitFor();
  });
  await step('12 focus room with a shared timer that starts the follower\'s own timer', async () => {
    await tab(A, 'Focus Together');
    await A.getByRole('button', { name: 'New room' }).click();
    await A.getByPlaceholder('Evening study session').fill('Evening study');
    await A.getByRole('dialog').getByRole('button', { name: /Ahmed/ }).click();
    await A.getByRole('button', { name: 'Create room' }).click();
    await tab(B, 'Focus Together');
    await B.getByRole('button', { name: 'Join' }).click();
    await A.getByRole('main').getByRole('button', { name: 'Focus', exact: true }).click();
    await B.getByText('Shared focus').waitFor();
    await B.getByRole('navigation').getByText('Focus Together').waitFor();   // B's own timer started
    await A.getByRole('main').getByText('Focusing').first().waitFor();       // …and A sees B (and itself) focusing
    await A.screenshot({ path: `${S}/4-room.png` });
  });
  await step('14 nothing private reached the server', async () => {
    await sleep(1500);
    const state = fs.readFileSync(path.join(S, 'state.json'), 'utf8');
    if (/Secret thesis/.test(state)) throw new Error('a task title was found in the server state');
    if (!/"username":"ahmed"/.test(state)) throw new Error('state file looks empty');
  });
  await step('15+16 server down: the tracker keeps working and records are intact', async () => {
    server.kill(); await sleep(500);
    await A.getByRole('navigation').getByRole('button', { name: 'Focus', exact: true }).click();
    await A.getByRole('button', { name: /Stop|Finish/ }).first().click();
    await A.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => {});
    await A.getByRole('tab', { name: 'Time log' }).click();
    const n = await A.getByRole('main').locator('.group').count();
    if (n !== 1) throw new Error(`expected exactly 1 local time entry for A, found ${n}`);
    await nav(A, 'My Tasks');
    const add = A.getByLabel('Add task', { exact: true });
    await add.fill('Works offline'); await add.press('Enter');
    await A.getByText('Works offline').waitFor();
  });
  await step('reconnects on its own when the server returns', async () => {
    server = spawn('node', ['server/dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: S }, stdio: 'ignore' });
    await nav(A, 'Social');
    await A.getByText('Friends online').waitFor({ timeout: 45000 });
    await A.getByText('@ahmed').first().waitFor();
  });
  console.log(errors.length ? errors.slice(0, 8).join('\n') : 'no page errors');
  console.log('screenshots in', S);
  await browser.close();
  server.kill();
})();
