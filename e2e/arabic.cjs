// Walks the whole app in Arabic: checks direction, takes screenshots, and reports any text left in English.
// Run against `npm run preview`:  node e2e/arabic.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-ar-'));
const BASE = process.env.TEMPO_URL || 'http://localhost:4173';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // First run in Arabic; later reloads keep whatever the app itself chose.
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('tempo.lang')) localStorage.setItem('tempo.lang', 'ar'); } catch {} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE ' + m.text()));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { process.exitCode = 1; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}.png` }); } };
  const latin = new Set();
  // Visible text that still contains English words (brand names, shortcuts and user data excepted).
  const scan = async () => {
    const found = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const allow = /^(Tempo|XP|PDF|JSON|CSV|SQLite|Markdown|Enter|Esc|Ctrl|Alt|Shift|Space|N|KB|Wi-Fi|docs\/SOCIAL\.md|English|AM|PM)$/;
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        const el = walker.currentNode.parentElement;
        if (!t || !el || el.closest('code,kbd,[dir="ltr"],option[value="en"]') || !el.offsetParent) continue;
        const words = (t.match(/[A-Za-z]{2,}/g) || []).filter((w) => !allow.test(w));
        if (words.length && !/^(@|#)/.test(t.replace(/[⁦⁩]/g, ''))) out.push(t.slice(0, 80));
      }
      for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
        for (const a of ['placeholder', 'title', 'aria-label']) {
          const v = el.getAttribute(a);
          if (v && /[A-Za-z]{3,}/.test(v) && !/[؀-ۿ]/.test(v) && !/^(1ABC|wss?:|youssef|Command|Tempo)/.test(v)) out.push(`[${a}] ${v.slice(0, 70)}`);
        }
      }
      return out;
    });
    found.forEach((f) => latin.add(f));
  };
  const nav = async (name) => { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(250); };
  const shot = async (n) => { await page.waitForTimeout(250); await scan(); await page.screenshot({ path: `${S}/${n}.png` }); };

  await page.goto(BASE + '/');
  await step('interface is Arabic and right-to-left', async () => {
    await page.getByRole('navigation').getByText('الرئيسية').waitFor();
    const d = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang, getComputedStyle(document.body).fontFamily]);
    if (d[0] !== 'rtl' || d[1] !== 'ar' || !/Plex Sans Arabic/.test(d[2])) throw new Error('got ' + JSON.stringify(d));
    const nav = await page.getByRole('navigation').boundingBox();
    if (nav.x < 1000) throw new Error('sidebar is not on the right: x=' + nav.x);
    if (!(await page.evaluate(() => document.fonts.check('14px "IBM Plex Sans Arabic"')))) throw new Error('Arabic font did not load');
  });
  await step('project, tasks and quick add in Arabic', async () => {
    await nav('المشاريع');
    await page.getByRole('button', { name: 'مشروع جديد' }).click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('التحضير للمحكمة الصورية');
    await page.getByPlaceholder('e.g. 100h').or(page.getByRole('dialog').getByRole('textbox').nth(3)).first().fill('100 ساعة').catch(() => {});
    await shot('01-project-dialog');
    await page.getByRole('button', { name: 'إنشاء المشروع' }).click();
    const add = page.getByLabel('إضافة مهمة إلى المشروع');
    for (const t of ['بحث المادة 17', 'تحليل أحكام المحكمة الأوروبية', 'ملخص السوابق القضائية']) { await add.fill(t); await add.press('Enter'); await page.getByText(t).first().waitFor(); }
    await page.getByText('تحليل أحكام المحكمة الأوروبية').click();
    await shot('02-project-task-panel');
    await page.getByRole('button', { name: 'إغلاق اللوحة' }).click();
    await page.keyboard.press('n');
    await page.getByRole('dialog').getByRole('textbox').first().fill('مذاكرة القانون الدولي الإنساني لمدة ساعتين بكرة !عالية #دراسة');
    await page.getByText('غداً').first().waitFor();
    await page.getByText('2 س').first().waitFor();
    await shot('03-quick-add');
    await page.getByRole('button', { name: 'إضافة مهمة', exact: true }).click();
  });
  await step('tasks views', async () => {
    await nav('مهامي');
    await page.getByRole('tab', { name: 'الكل', exact: true }).click();
    await shot('04-tasks-all');
    await page.getByTitle('لوحة كانبان', { exact: true }).click(); await shot('05-board');
    await page.getByTitle('مصفوفة أيزنهاور', { exact: true }).click(); await shot('06-matrix');
    await page.getByTitle('الخط الزمني', { exact: true }).click(); await shot('07-timeline');
    await page.getByTitle('قائمة', { exact: true }).click();
    await page.getByRole('button', { name: 'التصفية' }).click(); await shot('08-filters');
  });
  await step('focus: stopwatch, stop, review, time log', async () => {
    await nav('التركيز'); await shot('09-focus-setup');
    await page.getByRole('tab', { name: 'ساعة إيقاف' }).click();
    await page.getByRole('button', { name: /^ابدأ/ }).click();
    await page.getByRole('timer').waitFor(); await page.waitForTimeout(1600); await shot('10-focus-running');
    await page.getByRole('button', { name: 'إنهاء', exact: true }).first().click();
    await page.getByRole('dialog').waitFor(); await shot('11-session-review');
    await page.getByRole('button', { name: 'تخطٍّ' }).click();
    await page.getByRole('tab', { name: 'سجلّ الوقت' }).click();
    await page.getByRole('button', { name: 'إضافة وقت' }).click();
    await page.getByRole('dialog').locator('input[type=time]').fill('00:05');
    const dur = page.getByRole('dialog').getByPlaceholder('45 د', { exact: true }); await dur.fill('ساعة ونص'); await dur.press('Tab');
    await page.getByText(/ينتهي 01:35/).waitFor(); await shot('12-manual-entry');
    await page.getByRole('dialog').getByRole('button', { name: /^حفظ/ }).click();
    await page.getByRole('button', { name: 'واصل' }).click();              // 90 minutes of focus is a level-up
    await page.getByRole('dialog').waitFor({ state: 'detached' }); await shot('13-time-log');
  });
  await step('calendar', async () => {
    await nav('التقويم'); await shot('14-calendar-week');
    await page.getByRole('button', { name: 'حدث', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('اجتماع المشروع'); await shot('15-event-dialog');
    await page.getByRole('dialog').getByRole('button', { name: /^حفظ/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    for (const [v, n] of [['شهر', '16-calendar-month'], ['الأجندة', '17-calendar-agenda'], ['أسبوع', '18-calendar-week-event']]) { await page.getByRole('tab', { name: v, exact: true }).click(); await shot(n); }
  });
  await step('habits, goals, analytics, rewards, journal', async () => {
    await nav('العادات');
    await page.getByRole('button', { name: 'أنشئ عادة' }).click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('الصلوات الخمس');
    await page.getByRole('dialog').getByRole('combobox').first().selectOption('sessions');
    await page.getByRole('dialog').getByRole('spinbutton').fill('5'); await shot('19-habit-dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
    await page.getByRole('button', { name: 'تسجيل', exact: true }).click(); await shot('20-habits');
    await nav('الأهداف');
    await page.getByRole('button', { name: 'الهدف الأسبوعي', exact: true }).click(); await shot('21-target-dialog');
    await page.getByRole('button', { name: 'إلغاء' }).click(); await shot('22-goals');
    await nav('التحليلات'); await page.waitForTimeout(400); await shot('23-analytics');
    await nav('المكافآت'); await shot('24-rewards');
    await nav('اليوميات'); await shot('25-journal');
  });
  await step('social onboarding, settings, dashboard, search', async () => {
    await nav('الأصدقاء'); await shot('26-social');
    await page.getByRole('navigation').getByRole('button', { name: 'الإعدادات' }).click(); await shot('27-settings');
    await page.getByRole('radio', { name: 'وردي', exact: true }).click(); await page.waitForTimeout(200);
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    if (accent !== '199 36 121') throw new Error('accent not applied: ' + accent);
    await nav('الرئيسية'); await shot('28-dashboard-pink');
    await page.getByRole('button', { name: 'الوضع الداكن' }).click(); await shot('29-dashboard-pink-dark');
    await page.getByRole('button', { name: 'الوضع الفاتح' }).click();
    await page.keyboard.press('Control+k'); await page.getByRole('dialog').getByRole('textbox').fill('المادة'); await shot('30-search');
    await page.keyboard.press('Escape');
  });
  await step('switching back to English reloads left-to-right', async () => {
    await page.getByRole('navigation').getByRole('button', { name: 'الإعدادات' }).click();
    await page.getByLabel('اللغة').selectOption('en');
    await page.getByRole('navigation').getByText('Dashboard').waitFor({ timeout: 10000 });
    if ((await page.evaluate(() => document.documentElement.dir)) !== 'ltr') throw new Error('direction did not switch back');
  });
  console.log(errors.length ? errors.slice(0, 8).join('\n') : 'no console errors');
  console.log('untranslated visible text:', latin.size);
  [...latin].slice(0, 80).forEach((l) => console.log('   ·', l));
  console.log('screenshots in', S);
  await browser.close();
})();
