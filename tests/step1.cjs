// Запуск: node tests/step1.cjs. Только встроенные средства Node.js.
const assert = require('node:assert/strict');
const { Store, Defaults, Validation, AreaService, SettingsService, Utils, DataMigrations } = require('../app.js');
const tests = [];
const test = (name, run) => tests.push({ name, run });
function storage(raw = null) { return { raw, writes: 0, getItem() { return this.raw; }, setItem(key, value) { assert.equal(key, 'life168_app'); this.raw = value; this.writes++; }, removeItem() { this.raw = null; } }; }
function fresh() { const mem = storage(); Store.init(mem); return mem; }
test('Первый запуск: структура, значения по умолчанию и системные сферы', () => {
  const m = fresh(), s = Store.state;
  assert.equal(s.dataVersion, 1); assert.equal(s.settings.sleep.weekdayStart, '22:00'); assert.equal(s.settings.sleep.weekdayEnd, '06:00');
  assert.equal(s.settings.work.start, '09:00'); assert.equal(s.settings.work.end, '18:00'); assert.equal(s.settings.focus.workMinutes, 50);
  assert.equal(s.settings.commute.enabled, false); assert.equal(s.settings.weeklyBufferPercent, 5); assert.equal(s.lifeAreas.length, 15);
  assert.deepEqual(s.lifeAreas.filter(a => a.systemType).map(a => a.systemType), ['work', 'commute', 'uncategorized']);
  assert.equal(m.writes, 1); Validation.state(JSON.parse(m.raw));
});
test('Сохранение и перезагрузка состояния и вкладки', () => { const m = fresh(); Store.change(s => { s.profile.name = 'Анна'; s.uiState.activeSection = 'areas'; }); Store.init(m); assert.equal(Store.state.profile.name, 'Анна'); assert.equal(Store.state.uiState.activeSection, 'areas'); });
test('Повторное сохранение неизменённых данных не записывает состояние', () => { const m = fresh(); Store.save(); Store.save(); assert.equal(m.writes, 1); });
test('Создание, редактирование, скрытие и восстановление сферы', () => {
  fresh(); const a = { ...Defaults.areas()[1], id: Utils.id(), name: 'Моя сфера', order: 15, hidden: false };
  AreaService.save(a); assert.equal(Store.state.lifeAreas.length, 16);
  AreaService.save({ ...a, name: '<img src=x onerror=alert(1)>', color: '#abcdef', icon: 'star', hidden: true });
  assert.equal(AreaService.ordered(false).some(x => x.id === a.id), false);
  AreaService.save({ ...a, hidden: false }); assert.equal(AreaService.ordered(false).some(x => x.id === a.id), true);
});
test('Нормативы: необязательные поля, порядок, отрицательные и дробные минуты', () => {
  const a = Defaults.areas()[1]; Validation.area(a);
  Validation.area({ ...a, minimumHours: 1.5, comfortHours: null, maximumHours: 2 });
  for (const patch of [{ minimumHours: 5, comfortHours: 3 }, { minimumHours: -1 }, { maximumHours: Infinity }, { name: '' }, { name: 'я'.repeat(61) }, { description: 'я'.repeat(501) }, { color: 'url(bad)' }, { icon: 'unknown' }, { minimumHours: 0.001 }]) assert.throws(() => Validation.area({ ...a, ...patch }));
});
test('Суммы ориентиров: активные сферы, пустые значения и превышение 168 часов', () => {
  const base = Defaults.areas()[1];
  const totals = AreaService.totals([{...base,minimumHours:100,comfortHours:null,maximumHours:170},{...base,minimumHours:70,comfortHours:80,maximumHours:180},{...base,hidden:true,minimumHours:100}]);
  assert.equal(totals[0].minutes,10200); assert.equal(totals[0].over,120); assert.equal(totals[1].minutes,4800); assert.equal(totals[1].count,1);
  assert.equal(AreaService.totals([base])[0].count,0);
});
test('Порядок сфер и защита существующих блоков', () => {
  fresh(); const a = Store.state.lifeAreas[1]; Store.state.calendarBlocks.push({ id: 'b', primaryAreaId: a.id, protected: false });
  AreaService.move(a.id, -1); assert.equal(AreaService.ordered()[0].id, a.id);
  AreaService.save({ ...a, protected: true }); assert.equal(Store.state.calendarBlocks[0].protected, false);
});
test('Системные сферы не удаляются', () => { fresh(); for (const a of Store.state.lifeAreas.filter(x => x.systemType)) assert.throws(() => AreaService.remove(a.id, Store.state.lifeAreas[2].id)); });
test('Удаление переносит связи, сохраняя записи и исключая дубли сфер', () => {
  fresh(); const a = Store.state.lifeAreas[1], target = Store.state.lifeAreas.find(x => x.systemType === 'uncategorized');
  Store.state.tasks.push({ id: 't', areaId: a.id });
  Store.state.calendarBlocks.push({ id: 'b', primaryAreaId: a.id, additionalAreaIds: [a.id, target.id] });
  Store.state.recurrenceSeries.push({ id: 'r', template: { primaryAreaId: a.id } });
  assert.equal(AreaService.references(a.id), 3); assert.throws(() => AreaService.remove(a.id, 'absent'));
  AreaService.remove(a.id, target.id);
  assert.equal(Store.state.tasks[0].areaId, target.id); assert.equal(Store.state.calendarBlocks[0].primaryAreaId, target.id);
  assert.deepEqual(Store.state.calendarBlocks[0].additionalAreaIds, []); assert.equal(Store.state.recurrenceSeries[0].template.primaryAreaId, target.id);
});
test('Настройки и дата действия не меняют прошлые резервы и снимки', () => {
  fresh(); Store.state.capacityReservations.push({ id: 'past', startDateTime: '2026-01-01T09:00' }); Store.state.weekSnapshots.push({ weekId: '2026-W01', metrics: { test: 1 } });
  const before = JSON.stringify([Store.state.capacityReservations, Store.state.weekSnapshots]);
  const s = Utils.clone(Store.state.settings); s.work.start = '10:00';
  SettingsService.apply(s, 'Мария', Utils.monday(1));
  assert.equal(Store.state.settings.scheduleVersions[1].effectiveFrom, Utils.monday(1));
  assert.equal(Store.state.settings.scheduleVersions[0].work.start, '09:00');
  assert.equal(JSON.stringify([Store.state.capacityReservations, Store.state.weekSnapshots]), before);
  SettingsService.apply(s, 'Мария', Utils.monday(1)); assert.equal(Store.state.settings.scheduleVersions.length, 2);
});
test('Рабочая дорога и валидация настроек', () => {
  const s = Defaults.settings(); s.commute.enabled = true; Validation.settings(s);
  for (const edit of [x => x.work.start = '25:00', x => x.sleep.weekdayEnd = x.sleep.weekdayStart, x => x.commute.days = [], x => x.weeklyBufferPercent = 51, x => x.calendarEndHour = x.calendarStartHour, x => x.focus.workMinutes = 0, x => x.focus.breakMinutes = 1.5]) { const c = Utils.clone(s); edit(c); assert.throws(() => Validation.settings(c)); }
});
test('Повреждённый JSON и будущая версия не перезаписываются', () => {
  for (const raw of ['{broken', JSON.stringify({ ...Defaults.state(), dataVersion: 2 }), JSON.stringify({ dataVersion: 1 })]) { const m = storage(raw); assert.equal(Store.init(m), false); Store.save(); assert.equal(m.raw, raw); assert.equal(m.writes, 0); assert.equal(Store.blocked, true); }
});
test('Отказ чтения localStorage не вызывает падение', () => { assert.equal(Store.init({ getItem() { throw new Error('Forbidden'); } }), false); assert.equal(Store.blocked, true); });
test('Ошибка квоты сохраняет изменения в памяти и допускает повторную запись', () => {
  const m = fresh(), before = m.raw, set = m.setItem; m.setItem = () => { const e = new Error(); e.name = 'QuotaExceededError'; throw e; };
  Store.change(s => { s.profile.name = 'Не потерять'; }); assert.equal(Store.state.profile.name, 'Не потерять'); assert.equal(m.raw, before); assert.match(Store.lastError, /Место/);
  assert.equal(JSON.parse(Store.snapshot()).profile.name, 'Не потерять'); m.setItem = set; Store.save(); assert.equal(Store.lastError, ''); assert.equal(JSON.parse(m.raw).profile.name, 'Не потерять');
});
test('Миграция не изменяет исходный объект', () => { const s = Defaults.state(), copy = DataMigrations[1](s); copy.profile.name = 'Другое'; assert.equal(s.profile.name, ''); });
test('Текст: задержка 1500 мс и немедленный flush', async () => {
  const m = fresh(); Store.change(s => { s.profile.name = 'А'; }, true); Store.change(s => { s.profile.name = 'Анна'; }, true);
  assert.equal(m.writes, 1); await new Promise(resolve => setTimeout(resolve, 1600)); assert.equal(m.writes, 2);
  Store.change(s => { s.profile.name = 'Анна 2'; }, true); Store.save(); assert.equal(m.writes, 3); assert.equal(JSON.parse(m.raw).profile.name, 'Анна 2');
});
(async () => { let failed = 0; for (const t of tests) { try { await t.run(); console.log('OK ' + t.name); } catch (e) { failed++; console.error('FAIL ' + t.name + '\n' + e.stack); } } clearTimeout(Store.timer); console.log(`${tests.length - failed}/${tests.length} passed`); process.exitCode = failed ? 1 : 0; })();
