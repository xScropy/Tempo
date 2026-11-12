// Friends on different networks: one starts a group, the other joins with the code.
// Everything goes through an MQTT broker (a local one here, standing in for the public relay)
// and is end-to-end encrypted with the group code.
// Run against `npm run preview`:  node e2e/group.cjs
const { chromium } = require('playwright');
const { createServer } = require('http');
const { WebSocketServer, createWebSocketStream } = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-group-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';

(async () => {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const wire = [];
  broker.on('publish', (p) => p.topic.startsWith('tempo/') && wire.push(Buffer.from(p.payload)));
  const http = createServer();
  new WebSocketServer({ server: http }).on('connection', (s) => broker.handle(createWebSocketStream(s)));
  await new Promise((r) => http.listen(0, r));
  const brokerUrl = `ws://127.0.0.1:${http.address().port}`;

  // Same as the desktop window: timers keep running in windows that are not in front.
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const errors = [];
  const user = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript((u) => { try { localStorage.setItem('tempo.relayBrokers', JSON.stringify([u])); } catch { /* about:blank has no storage */ } }, brokerUrl);
    const page = await ctx.newPage();
    page.setDefaultTimeout(9000);
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
    await page.goto(BASE + '/#/friends');
    return page;
  };
  const A = await user('youssef');
  const B = await user('ahmed');
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); await A.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}-A.png` }).catch(() => {}); await B.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}-B.png` }).catch(() => {}); } };
  const tab = (p, t) => p.getByRole('tab', { name: new RegExp('^' + t) }).click();
  let code = '';

  await step('host starts a group and gets a code', async () => {
    await A.getByPlaceholder('youssef', { exact: true }).fill('youssef');
    await A.getByPlaceholder('Youssef', { exact: true }).fill('Youssef');
    await A.screenshot({ path: `${S}/1-start.png` });
    await A.getByRole('button', { name: 'Create profile and start the group' }).click();
    await A.getByText('Friends online').waitFor();
    await tab(A, 'Profile');
    code = (await A.locator('code.text-lg').innerText()).trim();
    if (!/^1[A-Z0-9]{3}(-[A-Z0-9]{4}){3}$/.test(code)) throw new Error('unexpected code ' + code);
    await A.getByText('● Reachable').waitFor();
    await A.screenshot({ path: `${S}/2-code.png` });
  });
  await step('a wrong code is rejected with a clear message', async () => {
    await B.getByRole('button', { name: /Join with a code/ }).click();
    await B.getByPlaceholder('1ABC-DEFG-HJKM-NPQR').fill('1AAA-BBBB-CCCC-DDDD');
    await B.getByPlaceholder('youssef', { exact: true }).fill('ahmed');
    await B.getByPlaceholder('Youssef', { exact: true }).fill('Ahmed');
    await B.getByRole('button', { name: 'Create profile and connect' }).click();
    await B.getByText(/host is not online/).waitFor({ timeout: 20000 });
  });
  await step('friend joins with the real code', async () => {
    await B.getByPlaceholder('1ABC-DEFG-HJKM-NPQR').fill(code.toLowerCase().replace(/-/g, ' '));
    await B.getByRole('button', { name: 'Create profile and connect' }).click();
    await B.getByText('Friends online').waitFor({ timeout: 20000 });
  });
  await step('they become friends and see live focus across the relay', async () => {
    await tab(A, 'Friends');
    await A.getByLabel('Search by username').fill('ahm');
    await A.getByRole('button', { name: 'Add', exact: true }).click();
    await B.getByRole('button', { name: 'Accept' }).click();
    await A.getByText('@ahmed').first().waitFor();
    await B.getByRole('navigation').getByRole('button', { name: 'Focus', exact: true }).click();
    await B.getByRole('button', { name: 'Start pomodoro' }).click();
    await A.getByText(/25-minute pomodoro · 00:\d\d elapsed · 2\d:\d\d left/).waitFor();
    await A.screenshot({ path: `${S}/3-live.png` });
  });
  await step('the relay carried only ciphertext', async () => {
    const all = Buffer.concat(wire).toString('latin1');
    if (wire.length < 10) throw new Error('nothing went through the broker');
    for (const word of ['youssef', 'ahmed', 'Youssef', 'register', 'focusing', 'pomodoro']) if (all.includes(word)) throw new Error(`"${word}" was readable on the relay`);
  });
  await step('host goes away: the friend is told, keeps working, and reconnects when the host returns', async () => {
    await A.waitForTimeout(500);                                         // nobody closes the app in the same instant
    await A.goto('about:blank');
    await B.getByRole('navigation').getByRole('button', { name: /^Social/ }).click();
    await B.getByText(/reconnecting|Not connected|Connecting/).first().waitFor({ timeout: 120000 });
    await B.getByRole('navigation').getByRole('button', { name: /^My Tasks/ }).click();
    const add = B.getByLabel('Add task', { exact: true });
    await add.fill('Still works'); await add.press('Enter');
    await B.getByText('Still works').waitFor();
    await A.goto(BASE + '/#/friends');
    await A.getByText('Friends online').waitFor({ timeout: 30000 });   // the group and its members survived the restart
    await A.getByText('@ahmed').first().waitFor();
    await B.getByRole('navigation').getByRole('button', { name: /^Social/ }).click();
    await B.getByText('@youssef').first().waitFor({ timeout: 60000 });
    await B.getByRole('main').getByText('Online').first().waitFor({ timeout: 30000 });
  });
  console.log(errors.length ? errors.slice(0, 8).join('\n') : 'no page errors');
  console.log('screenshots in', S);
  await browser.close();
  http.close(); process.exit(process.exitCode || 0);
})();
