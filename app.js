/* 168 — локальный планировщик. Настройки, календарь, бюджет и защита времени. */
(() => {
  'use strict';
  const KEY = 'life168_app';
  const CURRENT_DATA_VERSION = 1;
  const SOFT_LIMIT = 3 * 1024 * 1024;
  const SECTIONS = [
    ['week', 'Моя неделя', '▦'], ['budget', '168 часов', '◷'],
    ['areas', 'Сферы жизни', '◉'], ['inbox', 'Входящие', '▤'],
    ['tasks', 'Задачи', '✓'], ['focus', 'Фокус', '◴'],
    ['analytics', 'Аналитика', '▥'], ['settings', 'Настройки', '⚙']
  ];
  const RU = { icons: { leaf: 'Лист', heart: 'Сердце', circle: 'Круг', star: 'Звезда', book: 'Книга', home: 'Дом', sun: 'Солнце', work: 'Портфель', path: 'Дорога', venus: 'Венера Милосская', paw: 'Лапа', palette: 'Палитра', moon: 'Месяц' },
    symbols: { leaf: '❧', heart: '♡', circle: '○', star: '✧', book: '▤', home: '⌂', sun: '☼', work: '▣', path: '↗' } };
  const Utils = {
    id: () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    clone: value => JSON.parse(JSON.stringify(value)),
    minutes: time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
    duration: (start, end) => (Utils.minutes(end) - Utils.minutes(start) + 1440) % 1440,
    formatMinutes: m => `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}`,
    localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; },
    monday(offset = 0) { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7 + offset * 7); return Utils.localDate(d); },
    dateLabel: value => value.split('-').reverse().join('.'),
    size: value => new TextEncoder().encode(value).length,
    number: value => value === '' || value === null ? null : Number(value)
  };
  const Defaults = {
    settings() { return {
      sleep: { weekdayStart: '22:00', weekdayEnd: '06:00', weekendStart: '22:00', weekendEnd: '06:00' },
      work: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      commute: { enabled: false, days: [1, 2, 3, 4, 5], outStart: '08:00', outEnd: '09:00', backStart: '18:00', backEnd: '19:00' },
      focus: { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 20 },
      weeklyBufferPercent: 5, calendarStartHour: 5, calendarEndHour: 23,
      effectiveFrom: Utils.monday(), scheduleVersions: []
    }; },
    areas() {
      const names = ['Работа', 'Здоровье и тело', 'Дочь / семья', 'Родители', 'Собаки / прогулки', 'Собственный проект', 'Образование', 'Творчество', 'Культура', 'Чтение', 'Отдых и восстановление', 'Личное свободное время', 'Быт', 'Дорога', 'Без сферы'];
      const icons = ['work', 'leaf', 'heart', 'home', 'paw', 'star', 'book', 'palette', 'venus', 'book', 'moon', 'sun', 'home', 'path', 'circle'];
      return names.map((name, i) => ({ id: Utils.id(), name, icon: icons[i], color: ['#e7eee5', '#ece9f4', '#f4e6e3', '#ecebdc'][i % 4], minimumHours: null, comfortHours: null, maximumHours: null, protected: [1, 2, 3, 5, 10].includes(i), hidden: i >= 13, order: i, description: '', systemType: i === 0 ? 'work' : i === 13 ? 'commute' : i === 14 ? 'uncategorized' : null }));
    },
    state() { return { dataVersion: 1, profile: { name: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, settings: this.settings(), lifeAreas: this.areas(), capacityReservations: [], calendarBlocks: [], tasks: [], brainDumpItems: [], focusSessions: [], recurrenceSeries: [], recurrenceExceptions: [], displacementLog: [], weekSnapshots: [], uiState: { activeSection: 'week', onboardingComplete: false, showHidden: false } }; }
  };
  const Validation = {
    area(area) {
      if (!area.name.trim() || area.name.length > 60) throw new Error('Название сферы должно содержать от 1 до 60 символов.');
      if (area.description.length > 500) throw new Error('Описание не должно превышать 500 символов.');
      if (!Object.hasOwn(RU.icons, area.icon) || !/^#[0-9a-f]{6}$/i.test(area.color)) throw new Error('Выбери допустимые цвет и значок.');
      const values = ['minimumHours', 'comfortHours', 'maximumHours'].map(key => area[key]);
      if (values.some(n => n !== null && (!Number.isFinite(n) || n < 0 || !Number.isInteger(n * 60)))) throw new Error('Нормативы должны быть неотрицательными и задавать целое количество минут.');
      const specified = values.filter(n => n !== null);
      if (specified.some((n, i) => i && n < specified[i - 1])) throw new Error('Соблюдай порядок: минимум ≤ комфорт ≤ максимум.');
      return area;
    },
    settings(s) {
      const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      const interval = (start, end) => { if (!time(start) || !time(end) || start === end) throw new Error('Укажи разные начало и окончание интервала.'); };
      interval(s.sleep.weekdayStart, s.sleep.weekdayEnd); interval(s.sleep.weekendStart, s.sleep.weekendEnd);
      interval(s.work.start, s.work.end);
      if (s.commute.enabled) { interval(s.commute.outStart, s.commute.outEnd); interval(s.commute.backStart, s.commute.backEnd); }
      for (const days of [s.work.days, s.commute.days]) if (!Array.isArray(days) || days.some(n => !Number.isInteger(n) || n < 1 || n > 7) || new Set(days).size !== days.length) throw new Error('Проверь выбранные дни недели.');
      if (s.commute.enabled && !s.commute.days.length) throw new Error('Выбери хотя бы один день рабочей дороги.');
      if (!Number.isFinite(s.weeklyBufferPercent) || s.weeklyBufferPercent < 0 || s.weeklyBufferPercent > 50) throw new Error('Резерв недели — от 0 до 50%.');
      for (const value of Object.values(s.focus)) if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error('Интервал таймера — от 1 до 1440 целых минут.');
      if (!Number.isInteger(s.calendarStartHour) || !Number.isInteger(s.calendarEndHour) || s.calendarStartHour < 0 || s.calendarEndHour > 24 || s.calendarStartHour >= s.calendarEndHour) throw new Error('Диапазон календаря: от 0 до 24, начало раньше окончания.');
      return s;
    },
    state(s) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Неверная структура данных.');
      if (s.dataVersion > 1) throw new Error('Данные созданы в более новой версии приложения.');
      if (s.dataVersion !== 1) throw new Error('Для этой версии данных нет доступной миграции.');
      const arrays = ['lifeAreas', 'capacityReservations', 'calendarBlocks', 'tasks', 'brainDumpItems', 'focusSessions', 'recurrenceSeries', 'recurrenceExceptions', 'displacementLog', 'weekSnapshots'];
      for (const key of arrays) if (!Array.isArray(s[key])) throw new Error('Повреждена структура сохранённых данных.');
      for (const key of ['settings', 'profile', 'uiState']) if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) throw new Error('Повреждены настройки приложения.');
      const ids = new Set();
      for (const a of s.lifeAreas) {
        if (!a || typeof a.id !== 'string' || ids.has(a.id) || typeof a.name !== 'string' || typeof a.description !== 'string' || typeof a.hidden !== 'boolean' || typeof a.protected !== 'boolean' || !Number.isFinite(a.order) || ![null, 'work', 'commute', 'uncategorized'].includes(a.systemType)) throw new Error('Повреждён список сфер.');
        ids.add(a.id); this.area(a);
      }
      for (const type of ['work', 'commute', 'uncategorized']) if (s.lifeAreas.filter(a => a.systemType === type).length !== 1) throw new Error('Не найдены обязательные системные сферы.');
      this.settings(s.settings);
      if (s.reservationFacts !== undefined && !Array.isArray(s.reservationFacts)) throw Error('Повреждены подтверждения рабочего времени.');
      const timer = s.uiState.focusTimer;
      if (timer && (!['work', 'break'].includes(timer.phase) || !['running', 'paused', 'ready', 'stopped'].includes(timer.status) || typeof timer.id !== 'string' || !Number.isFinite(timer.durationMs) || timer.durationMs < 60000 || timer.durationMs > 86400000 || !Number.isFinite(timer.elapsedMs) || timer.elapsedMs < 0 || timer.elapsedMs > timer.durationMs || !Array.isArray(timer.segments) || timer.segments.some(p => !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start) || timer.status === 'running' && !Number.isFinite(timer.runStartedAt))) throw Error('Повреждены данные таймера.');
      if (typeof s.profile.name !== 'string' || s.profile.name.length > 60) throw new Error('Повреждено имя пользователя.');
      if (!SECTIONS.some(([id]) => id === s.uiState.activeSection)) s.uiState.activeSection = 'week';
      return s;
    }
  };
  const DataMigrations = { 1: data => Utils.clone(data) };
  const Store = {
    state: null, revision: 0, savedRevision: -1, timer: null, raw: null, blocked: false, lastError: '', bytes: 0, writes: 0, onStatus: () => {},
    init(storage) {
      this.storage = storage; this.blocked = false; this.lastError = ''; this.revision = 0; this.savedRevision = -1;
      try {
        this.raw = storage.getItem(KEY);
        this.state = this.raw === null ? Defaults.state() : TransferService.parse(this.raw);
        if (this.raw !== null) { this.savedRevision = 0; this.bytes = Utils.size(this.raw); }
      } catch (error) {
        this.state = Defaults.state(); this.blocked = true;
        this.lastError = this.raw !== null ? 'Сохранённые данные не удалось прочитать. Они не изменены.' : 'Браузер не разрешает доступ к локальному хранилищу.';
        this.onStatus(); return false;
      }
      if (this.raw === null) this.save();
      this.onStatus(); return true;
    },
    change(fn, text = false) {
      fn(this.state); this.revision++;
      clearTimeout(this.timer);
      if (text) { this.timer = setTimeout(() => this.save(), 1500); this.onStatus(); }
      else this.save();
    },
    save() {
      clearTimeout(this.timer);
      if (this.blocked || this.savedRevision === this.revision) return !this.blocked;
      try {
        const serialized = JSON.stringify(this.state); this.bytes = Utils.size(serialized);
        this.storage.setItem(KEY, serialized); this.savedRevision = this.revision; this.writes++; this.lastError = '';
      } catch (error) {
        this.lastError = error.name === 'QuotaExceededError' ? 'Место в хранилище закончилось. Последние изменения есть только в памяти. Скачай резервную копию.' : 'Не удалось сохранить изменения. Они остаются в памяти страницы. Скачай резервную копию.';
      }
      this.onStatus(); return !this.lastError;
    },
    reset() { this.storage.removeItem(KEY); this.raw = null; this.init(this.storage); },
    snapshot() { this.save(); return JSON.stringify(this.state, null, 2); }
  };
  const AreaService = {
    totals(areas) {
      return ['minimumHours', 'comfortHours', 'maximumHours'].map(key => {
        const values = areas.filter(a => !a.hidden).map(a => a[key]).filter(n => n !== null && Number.isFinite(n) && n >= 0);
        const minutes = values.reduce((sum, n) => sum + Math.round(n * 60), 0);
        return { key, minutes, count: values.length, over: Math.max(0, minutes - 10080) };
      });
    },
    ordered(includeHidden = true) { return Store.state.lifeAreas.filter(a => includeHidden || !a.hidden).slice().sort((a, b) => a.order - b.order); },
    save(area) { Validation.area(area); Store.change(s => { const i = s.lifeAreas.findIndex(a => a.id === area.id); if (i < 0) s.lifeAreas.push(area); else s.lifeAreas[i] = area; delete s.uiState.areaDraft; }); },
    move(id, direction) { const list = this.ordered(); const i = list.findIndex(a => a.id === id); if (i < 0 || !list[i + direction]) return; [list[i], list[i + direction]] = [list[i + direction], list[i]]; Store.change(() => list.forEach((a, order) => { a.order = order; })); },
    references(id) {
      const s = Store.state; const contains = o => o && (o.areaId === id || o.primaryAreaId === id || o.additionalAreaIds?.includes(id) || o.areaIds?.includes(id));
      return s.focusSessions.filter(contains).length + Number(Boolean(contains(s.uiState.focusTimer))) + s.tasks.filter(contains).length + s.calendarBlocks.filter(contains).length + s.recurrenceSeries.filter(o => contains(o) || contains(o.template)).length;
    },
    remove(id, targetId) {
      const s = Store.state; const a = s.lifeAreas.find(x => x.id === id);
      if (!a || a.systemType) throw new Error('Системную сферу нельзя удалить.');
      if (!targetId || targetId === id || !s.lifeAreas.some(x => x.id === targetId)) throw new Error('Выбери сферу для связанных записей.');
      Store.change(state => {
        const transfer = o => {
          if (!o || typeof o !== 'object') return;
          for (const key of ['areaId', 'primaryAreaId', 'sourceAreaId', 'targetAreaId']) if (o[key] === id) o[key] = targetId;
          for (const key of ['additionalAreaIds', 'areaIds']) if (Array.isArray(o[key])) o[key] = [...new Set(o[key].map(x => x === id ? targetId : x))].filter(x => key !== 'additionalAreaIds' || x !== o.primaryAreaId);
          if (o.template) transfer(o.template);
        };
        for (const list of [state.tasks, state.calendarBlocks, state.recurrenceSeries, state.capacityReservations, state.displacementLog, state.focusSessions]) list.forEach(transfer);
        transfer(state.uiState.focusTimer); transfer(state.uiState.focusDraft);
        state.lifeAreas = state.lifeAreas.filter(x => x.id !== id);
        if (state.uiState.areaDraft?.id === id) delete state.uiState.areaDraft;
      });
    }
  };
  const SettingsService = {
    apply(settings, name, effectiveFrom) {
      Validation.settings(settings);
      if (name.length > 60) throw new Error('Имя — не более 60 символов.');
      if (![Utils.monday(), Utils.monday(1)].includes(effectiveFrom)) throw new Error('Выбери начало текущей или следующей недели.');
      const previous = Store.state.settings;
      const schedule = { sleep: Utils.clone(settings.sleep), work: Utils.clone(settings.work), commute: Utils.clone(settings.commute) };
      const oldSchedule = { sleep: previous.sleep, work: previous.work, commute: previous.commute };
      const versions = Utils.clone(previous.scheduleVersions || []);
      if (!versions.length && effectiveFrom > Utils.monday()) versions.push({ effectiveFrom: Utils.monday(), ...Utils.clone(oldSchedule) });
      if (!versions.length || JSON.stringify(schedule) !== JSON.stringify(oldSchedule) || effectiveFrom !== previous.effectiveFrom) {
        const entry = { effectiveFrom, ...schedule };
        const existing = versions.findIndex(v => v.effectiveFrom === effectiveFrom);
        if (existing >= 0) versions[existing] = entry; else versions.push(entry);
        versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      }
      Store.change(s => { s.settings = { ...Utils.clone(settings), ...(previous.focusPreferences ? { focusPreferences: Utils.clone(previous.focusPreferences) } : {}), materializedWeeks: Utils.clone(previous.materializedWeeks || {}), effectiveFrom, scheduleVersions: versions }; s.profile.name = name.trim(); delete s.uiState.settingsDraft; });
    }
  };

  // Календарные минуты — плавающее локальное время, не реальные UTC timestamps.
  // UTC используется только как независимая от часового пояса арифметическая шкала.
  const DateUtils = {
    minute(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Укажи корректные дату и время.');
      const [y, m, d, h, n] = value.match(/\d+/g).map(Number);
      const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, n, 0, 0);
      if (date.toISOString().slice(0, 16) !== value) throw new Error('Такой даты или времени не существует.');
      return date.getTime() / 60000;
    },
    stamp: minute => new Date(minute * 60000).toISOString().slice(0, 16),
    add(date, days) { return this.stamp(this.minute(`${date}T00:00`) + days * 1440).slice(0, 10); },
    weekday(date) { return new Date(this.minute(`${date}T00:00`) * 60000).getUTCDay() || 7; },
    weekStart(date = Utils.localDate()) { return this.add(date, 1 - this.weekday(date)); },
    weekId(date) {
      const thu = this.add(this.weekStart(date), 3), year = thu.slice(0, 4);
      const first = this.weekStart(`${year}-01-04`);
      return `${year}-W${String(1 + Math.round((this.minute(`${thu}T00:00`) - this.minute(`${first}T00:00`)) / 10080)).padStart(2, '0')}`;
    },
    bounds(date) { const start = this.minute(`${this.weekStart(date)}T00:00`); return [start, start + 10080]; },
    interval(date, start, end) { const a = this.minute(`${date}T${start}`); let b = this.minute(`${date}T${end}`); if (b <= a) b += 1440; return { startDateTime: this.stamp(a), endDateTime: this.stamp(b) }; }
  };
  const Intervals = {
    clip(interval, start, end) { const a = Math.max(interval[0], start), b = Math.min(interval[1], end); return b > a ? [a, b] : null; },
    union(items) { const result = []; for (const [a, b] of items.filter(Boolean).slice().sort((x, y) => x[0] - y[0])) { if (b <= a) continue; const last = result.at(-1); if (last && a <= last[1]) last[1] = Math.max(last[1], b); else result.push([a, b]); } return result; },
    length(items) { return this.union(items).reduce((n, [a, b]) => n + b - a, 0); },
    intersect(a, b) { const out = []; for (const x of a) for (const y of b) { const c = this.clip(x, y[0], y[1]); if (c) out.push(c); } return this.union(out); },
    of(item) { return [DateUtils.minute(item.startDateTime), DateUtils.minute(item.endDateTime)]; }
  };
  const BLOCK_STATUSES = { planned: 'Запланировано', completed: 'Выполнено', partial: 'Выполнено частично', skipped: 'Пропущено', cancelled: 'Отменено' };
  const ENERGY_NAMES = { low: 'Низкая энергия', medium: 'Средняя энергия', high: 'Высокая энергия' };
  const activeBlock = b => ['planned', 'completed', 'partial'].includes(b.status);
  const ReservationService = {
    schedule(state, date) {
      const versions = state.settings.scheduleVersions || [];
      const applicable = versions.filter(v => v.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
      return applicable || (versions.length ? null : { sleep: state.settings.sleep, work: state.settings.work, commute: state.settings.commute });
    },
    generate(state, week) {
      const [start, end] = DateUtils.bounds(week), result = [];
      const add = (date, type, from, to) => {
        const raw = DateUtils.interval(date, from, to), clipped = Intervals.clip(Intervals.of(raw), start, end); if (!clipped) return;
        const area = state.lifeAreas.find(a => a.systemType === (type === 'work' ? 'work' : 'commute'));
        result.push({ id: `reserve:${week}:${type}:${date}:${from}`, weekId: DateUtils.weekId(week), type, source: 'settings', ...(type !== 'sleep' ? { primaryAreaId: area.id } : {}), ...(type === 'commute' ? { commuteType: 'work' } : {}), startDateTime: DateUtils.stamp(clipped[0]), endDateTime: DateUtils.stamp(clipped[1]) });
      };
      for (let i = -1; i < 7; i++) {
        const date = DateUtils.add(week, i);
        // Предыдущий вечер даёт начальную часть сна понедельника при первом запуске.
        const schedule = this.schedule(state, date) || (i === -1 ? this.schedule(state, week) : null); if (!schedule) continue;
        const day = DateUtils.weekday(date), weekend = day >= 6;
        add(date, 'sleep', schedule.sleep[weekend ? 'weekendStart' : 'weekdayStart'], schedule.sleep[weekend ? 'weekendEnd' : 'weekdayEnd']);
        if (schedule.work.days.includes(day)) add(date, 'work', schedule.work.start, schedule.work.end);
        if (schedule.commute.enabled && schedule.commute.days.includes(day)) { add(date, 'commute', schedule.commute.outStart, schedule.commute.outEnd); add(date, 'commute', schedule.commute.backStart, schedule.commute.backEnd); }
      }
      return result;
    },
    ensure(state, date) {
      const week = DateUtils.weekStart(date), weekId = DateUtils.weekId(week);
      if (!state.settings.scheduleVersions?.length) state.settings.scheduleVersions = [{ effectiveFrom: state.settings.effectiveFrom || Utils.monday(), sleep: Utils.clone(state.settings.sleep), work: Utils.clone(state.settings.work), commute: Utils.clone(state.settings.commute) }];
      state.settings.materializedWeeks ||= {};
      const existing = state.settings.materializedWeeks[week];
      const signature = JSON.stringify([this.schedule(state, week), this.schedule(state, DateUtils.add(week, -1))]);
      if (existing && (week < Utils.monday() || existing.signature === signature)) return false;
      // Сохранённые интервалы прошлой версии не удаляются при первом открытии истории.
      if (week < Utils.monday() && state.capacityReservations.some(r => r.weekId === weekId)) { state.settings.materializedWeeks[week] = { signature: 'historical' }; return true; }
      const old = new Map(state.capacityReservations.filter(r => r.weekId === weekId).map(r => [r.id, r]));
      state.capacityReservations = state.capacityReservations.filter(r => r.weekId !== weekId);
      for (const r of this.generate(state, week)) state.capacityReservations.push({ ...old.get(r.id), ...r });
      state.settings.materializedWeeks[week] = { signature, bufferPercent: state.settings.weeklyBufferPercent };
      return true;
    }
  };
  const RecurrenceService = {
    dates(rule, from, to) {
      const result = []; if (!rule) return result;
      const begin = from > rule.startDate ? from : rule.startDate;
      const end = rule.until && rule.until < to ? rule.until : to;
      for (let date = begin; date <= end; date = DateUtils.add(date, 1)) if (rule.frequency === 'daily' || rule.weekdays.includes(DateUtils.weekday(date))) result.push(date);
      return result;
    },
    occurrence(rule, date) {
      const template = rule.template, start = DateUtils.minute(`${date}T${template.startDateTime.slice(11)}`);
      return { ...Utils.clone(template), id: `${rule.seriesId}@${date}`, seriesId: rule.seriesId, occurrenceDate: date, virtual: true, startDateTime: DateUtils.stamp(start), endDateTime: DateUtils.stamp(start + template.plannedMinutes) };
    },
    blocks(state, from, to) {
      const result = [...state.calendarBlocks];
      const occupied = new Set(state.calendarBlocks.filter(b => b.seriesId).map(b => `${b.seriesId}@${b.occurrenceDate}`));
      const excepted = new Set(state.recurrenceExceptions.map(e => `${e.seriesId}@${e.occurrenceDate}`));
      for (const rule of state.recurrenceSeries) for (const date of this.dates(rule, DateUtils.add(from, -1), to)) {
        const key = `${rule.seriesId}@${date}`; if (!occupied.has(key) && !excepted.has(key)) result.push(this.occurrence(rule, date));
      }
      const lo = DateUtils.minute(`${from}T00:00`), hi = DateUtils.minute(`${DateUtils.add(to, 1)}T00:00`);
      return result.filter(b => b.startDateTime && b.endDateTime && Intervals.clip(Intervals.of(b), lo, hi));
    },
    exception(state, old, replacement) {
      state.recurrenceExceptions = state.recurrenceExceptions.filter(e => !(e.seriesId === old.seriesId && e.occurrenceDate === old.occurrenceDate));
      state.calendarBlocks = state.calendarBlocks.filter(b => !(b.seriesId === old.seriesId && b.occurrenceDate === old.occurrenceDate));
      state.recurrenceExceptions.push({ id: Utils.id(), seriesId: old.seriesId, occurrenceDate: old.occurrenceDate, type: replacement ? 'modified' : 'cancelled', replacementBlockId: replacement?.id || null });
      if (replacement) state.calendarBlocks.push({ ...replacement, seriesId: old.seriesId, occurrenceDate: old.occurrenceDate, isException: true });
    }
  };
  const BudgetService = {
    compatible(reserve, block, state) {
      const type = state.lifeAreas.find(a => a.id === block.primaryAreaId)?.systemType;
      return reserve.type === 'work' && type === 'work' || reserve.type === 'commute' && type === 'commute' && block.commuteType === 'work';
    },
    status(overload, conflict, free, target) { return overload > 300 ? 'Критическая перегрузка' : overload > 0 ? 'Перегруз' : conflict > 0 ? 'Конфликт расписания' : free < target ? 'Плотная неделя' : 'Сбалансированная неделя'; },
    calculate(state, date, range) {
      const week = DateUtils.weekStart(date), bounds = range || DateUtils.bounds(date), [start, end] = bounds;
      const reserves = state.capacityReservations.map(r => ({ ...r, span: Intervals.clip(Intervals.of(r), start, end) })).filter(r => r.span);
      const blocks = RecurrenceService.blocks(state, week, DateUtils.add(week, 6)).filter(activeBlock).map(b => ({ ...b, span: Intervals.clip(Intervals.of(b), start, end) })).filter(b => b.span);
      const rTypes = ['sleep', 'work', 'commute'].flatMap(type => Intervals.union(reserves.filter(r => r.type === type).map(r => r.span)).map(span => ({ type, span })));
      const physical = Intervals.length([...rTypes, ...blocks].map(x => x.span));
      const reservationDemand = rTypes.reduce((n, r) => n + r.span[1] - r.span[0], 0);
      const demand = reservationDemand + blocks.reduce((n, b) => n + b.span[1] - b.span[0] - Intervals.length(reserves.filter(r => this.compatible(r, b, state)).map(r => Intervals.clip(r.span, ...b.span))), 0);
      const points = [...new Set([...rTypes, ...blocks].flatMap(x => x.span))].sort((a, b) => a - b); let conflict = 0; const conflictSpans = [];
      for (let i = 0; i < points.length - 1; i++) {
        const at = points[i], activeR = rTypes.filter(r => r.span[0] <= at && r.span[1] > at), activeB = blocks.filter(b => b.span[0] <= at && b.span[1] > at);
        if (activeR.length > 1 || activeB.length > 1 || activeR.some(r => activeB.some(b => !this.compatible(r, b, state)))) { conflict += points[i + 1] - at; conflictSpans.push([at, points[i + 1]]); }
      }
      const sleep = Intervals.length(rTypes.filter(r => r.type === 'sleep').map(r => r.span)), waking = end - start - sleep, free = end - start - physical;
      const bufferPercent = week < Utils.monday() ? (state.settings.materializedWeeks?.[week]?.bufferPercent ?? state.settings.weeklyBufferPercent) : state.settings.weeklyBufferPercent;
      const target = Math.round(waking * bufferPercent / 100), overload = Math.max(0, demand - (end - start));
      const work = Intervals.length([...reserves.filter(r => r.type === 'work'), ...blocks.filter(b => state.lifeAreas.find(a => a.id === b.primaryAreaId)?.systemType === 'work')].map(r => r.span));
      const contributions = {};
      for (const b of blocks) for (const area of new Set([b.primaryAreaId, ...(b.additionalAreaIds || [])])) contributions[area] = (contributions[area] || 0) + b.span[1] - b.span[0];
      const workId = state.lifeAreas.find(a => a.systemType === 'work')?.id; if (workId) contributions[workId] = work;
      return { physical, demand, overload, conflict, conflictSpans, remaining: free, sleep, waking, nonSleep: physical - sleep, free, target, work, reservationDemand, contributions, status: this.status(overload, conflict, free, target), blocks, reserves };
    }
  };
  const ProtectionService = {
    parts(old, next, state) {
      if (!old?.protected || !activeBlock(old) || state.lifeAreas.find(a => a.id === old.primaryAreaId)?.systemType === 'work') return [];
      const [a, b] = Intervals.of(old), parts = [];
      for (let week = DateUtils.weekStart(old.startDateTime.slice(0, 10)); DateUtils.minute(`${week}T00:00`) < b; week = DateUtils.add(week, 7)) {
        const bounds = DateUtils.bounds(week), span = Intervals.clip([a, b], ...bounds); if (!span) continue;
        const kept = next && activeBlock(next) && next.primaryAreaId === old.primaryAreaId ? Intervals.length([Intervals.clip(Intervals.of(next), ...bounds)]) : 0;
        const minutes = Math.max(0, span[1] - span[0] - kept);
        if (minutes) parts.push({ date: DateUtils.stamp(span[0]).slice(0, 10), weekId: DateUtils.weekId(week), minutes });
      }
      return parts;
    },
    loss(old, next, state) { return this.parts(old, next, state).reduce((n, p) => n + p.minutes, 0); },
    entries(state, date) {
      const week = DateUtils.weekStart(date), end = DateUtils.add(week, 6);
      const blocks = RecurrenceService.blocks(state, week, end), consumed = {};
      const resolved = (entry, day) => {
        const restoration = entry.restorations?.[day];
        if (!restoration) return entry.seriesRule ? entry.resolutions?.[day] || 0 : entry.resolvedMinutes || 0;
        const b = blocks.find(b => b.id === restoration.blockId && b.protected && activeBlock(b) && b.primaryAreaId === entry.sourceAreaId);
        if (!b) return 0;
        const minutes = Math.max(0, Math.min(restoration.minutes, Intervals.length([Intervals.clip(Intervals.of(b), ...DateUtils.bounds(day))]) - (consumed[b.id] || 0)));
        consumed[b.id] = (consumed[b.id] || 0) + minutes;
        return minutes;
      };
      return state.displacementLog.flatMap(entry => {
        if (!entry.seriesRule) return entry.weekId === DateUtils.weekId(week) ? [{ ...entry, resolvedMinutes: resolved(entry, entry.date) }] : [];
        const rows = RecurrenceService.dates(entry.seriesRule, DateUtils.add(week, -1), end).filter(day => entry.occurrenceLosses?.[day] !== 0).map(day => {
          const source = RecurrenceService.occurrence(entry.seriesRule, day), span = Intervals.clip(Intervals.of(source), ...DateUtils.bounds(week));
          return span ? { day, date: DateUtils.stamp(span[0]).slice(0, 10), minutes: span[1] - span[0] } : null;
        }).filter(Boolean);
        const next = entry.replacementRule;
        let extra = 0;
        const available = {};
        if (next && next.template.primaryAreaId === entry.sourceAreaId && activeBlock(next.template)) for (const day of RecurrenceService.dates(next, DateUtils.add(week, -1), end)) {
          if (entry.occurrenceLosses?.[day] === 0) continue;
          const span = Intervals.clip(Intervals.of(RecurrenceService.occurrence(next, day)), ...DateUtils.bounds(week));
          if (span) available[day] = (available[day] || 0) + span[1] - span[0];
        }
        for (const row of rows) { const kept = Math.min(row.minutes, available[row.day] || 0); row.minutes -= kept; available[row.day] = (available[row.day] || 0) - kept; }
        extra = Object.values(available).reduce((n, v) => n + v, 0);
        for (const row of rows) { const moved = Math.min(row.minutes, extra); row.minutes -= moved; extra -= moved; }
        const grouped = {};
        for (const row of rows) grouped[row.date] = (grouped[row.date] || 0) + row.minutes;
        return Object.entries(grouped).filter(([, minutes]) => minutes > 0).map(([date, minutes]) => ({ ...entry, date, weekId: DateUtils.weekId(week), minutes, resolvedMinutes: Math.min(minutes, resolved(entry, date)) }));
      });
    },
    resolve(entryId, date, minutes, blockId) {
      const entry = Store.state.displacementLog.find(e => e.id === entryId);
      const current = entry && this.entries(Store.state, date).find(e => e.id === entryId && e.date === date);
      if (!entry || !current || !Number.isInteger(minutes) || minutes < 0 || minutes > current.minutes) throw new Error('Компенсация — целое число от нуля до потерянных минут.');
      const blocks = RecurrenceService.blocks(Store.state, DateUtils.weekStart(date), DateUtils.add(DateUtils.weekStart(date), 6));
      const target = blocks.find(b => (!blockId || b.id === blockId) && b.id !== entry.sourceBlockId && !(b.seriesId && b.seriesId === entry.sourceSeriesId && b.occurrenceDate === date) && b.protected && activeBlock(b) && b.primaryAreaId === entry.sourceAreaId && b.plannedMinutes >= minutes);
      if (minutes > 0 && !target) throw new Error('Сначала создай другой защищённый блок этой сферы в той же неделе на восстанавливаемое время.');
      if (minutes > 0) {
        const used = this.entries(Store.state, date).filter(e => !(e.id === entryId && e.date === date) && e.restorations?.[e.date]?.blockId === target.id).reduce((n, e) => n + e.resolvedMinutes, 0);
        if (used + minutes > Intervals.length([Intervals.clip(Intervals.of(target), ...DateUtils.bounds(date))])) throw new Error('Часть этого блока уже учтена как восстановление. Не хватает свободных минут для компенсации.');
      }
      Store.change(s => { const e = s.displacementLog.find(x => x.id === entryId); for (const snap of s.weekSnapshots) if (snap.weekId === DateUtils.weekId(date)) snap.needsRecalculation = true; e.restorations ||= {}; e.restorations[date] = { blockId: target?.id || null, minutes }; if (e.seriesRule) { e.resolutions ||= {}; e.resolutions[date] = minutes; } else { e.resolvedMinutes = minutes; e.resolved = minutes === e.minutes; e.resolvedAt = minutes ? new Date().toISOString() : null; } });
    }
  };
  const CalendarService = {
    validate(block, state) {
      if (!block.title.trim() || block.title.length > 120) throw new Error('Название блока — от 1 до 120 символов.');
      const [a, b] = Intervals.of(block); if (b - a < 1 || b - a > 1440) throw new Error('Длительность блока — от 1 минуты до 24 часов. Для ночного блока выбери дату окончания на следующий день.');
      block.plannedMinutes = b - a;
      FactService.validate(block.actualMinutes ?? null);
      if (!Object.hasOwn(BLOCK_STATUSES, block.status) || !Object.hasOwn(ENERGY_NAMES, block.energyRequired)) throw new Error('Выбери допустимый статус и уровень энергии.');
      if (!state.lifeAreas.some(x => x.id === block.primaryAreaId)) throw new Error('Выбери главную сферу.');
      if ((block.note || '').length > 2000) throw new Error('Заметка — не более 2000 символов.');
      block.additionalAreaIds = [...new Set(block.additionalAreaIds || [])].filter(id => id !== block.primaryAreaId);
      if (block.additionalAreaIds.some(id => !state.lifeAreas.some(a => a.id === id))) throw new Error('Дополнительная сфера не найдена.');
      return block;
    },
    prepare({ old = null, block = null, remove = false, scope = 'one', recurrence = null, dueToWork = false, reason = '' }, state = Store.state) {
      if (reason.length > 500) throw new Error('Причина — не более 500 символов.');
      const s = Utils.clone(state), notices = []; if (block && !remove) { block = this.validate(Utils.clone(block), s); delete block.virtual; block.id = old && !old.virtual ? old.id : Utils.id(); block.createdAt = old?.createdAt || new Date().toISOString(); block.updatedAt = new Date().toISOString(); }
      if (block && (!old || block.actualMinutes !== old.actualMinutes)) { block.timerFactBase = block.actualMinutes || 0; block.timerCredits = {}; }
      if (block?.sourceInboxId && !old && s.brainDumpItems.find(i => i.id === block.sourceInboxId)?.convertedBlockId) throw Error('Эта запись уже преобразована в блок.');
      const todayWeek = Utils.monday(), originalWeek = old ? DateUtils.weekStart(old.startDateTime.slice(0, 10)) : null;
      if ((originalWeek && originalWeek < todayWeek) || (block && DateUtils.weekStart(block.startDateTime.slice(0, 10)) < todayWeek)) notices.push('Ты изменяешь прошедшую неделю. Её данные будут обновлены; будущая аналитика учтёт это изменение.');
      if (old?.protected && (remove || block && ['startDateTime', 'endDateTime', 'primaryAreaId', 'protected', 'status'].some(k => block[k] !== old[k]))) notices.push(`Изменяется защищённый блок «${old.title}». Подтверди изменение личного времени.`);
      const isWork = block && s.lifeAreas.find(a => a.id === block.primaryAreaId)?.systemType === 'work';
      let loss = this.lossForOperation(old, remove ? null : block, s), lossSource = old;
      const workId = s.lifeAreas.find(a => a.systemType === 'work').id;
      let logRule = null, replacementRule = null;
      const rule = old?.seriesId && s.recurrenceSeries.find(r => r.seriesId === old.seriesId);
      if (rule && scope !== 'one') {
        const cutoff = scope === 'future' ? old.occurrenceDate : (rule.startDate > todayWeek ? rule.startDate : todayWeek);
        if (cutoff < todayWeek) throw new Error('Прошедший повтор измени отдельно. Изменение серии действует на текущую и будущие недели.');
        const oldRule = Utils.clone(rule);
        lossSource = RecurrenceService.occurrence(oldRule, old.occurrenceDate);
        loss = this.lossForOperation(lossSource, remove ? null : block, s);
        if (oldRule.template.protected && !old.protected) notices.push('Серия содержит защищённое время. Подтверди изменение будущих повторов.');
        logRule = { ...oldRule, startDate: cutoff };
        const count = RecurrenceService.dates(oldRule, cutoff, DateUtils.add(Utils.localDate(), 90)).length;
        if (remove) notices.push(`Удалить ${scope === 'all' ? 'всю серию' : 'это и будущие события'} «${old.title}»? Будущих повторов в ближайшие 90 дней: ${count}. Завершённые прошлые события сохранятся. Это действие нельзя отменить.`);
        const historyEnd = DateUtils.add(cutoff, -1); rule.until = rule.until && rule.until < historyEnd ? rule.until : historyEnd;
        const affected = s.calendarBlocks.filter(b => b.seriesId === rule.seriesId && b.occurrenceDate >= cutoff);
        if (remove) {
          s.calendarBlocks = s.calendarBlocks.filter(b => !affected.includes(b) || b.status === 'completed' && b.startDateTime.slice(0, 10) < Utils.localDate());
          s.recurrenceExceptions = s.recurrenceExceptions.filter(e => e.seriesId !== rule.seriesId || e.occurrenceDate < cutoff);
        } else {
          if (!recurrence) throw new Error('Для изменения серии выбери режим повторения.');
          const nextRule = this.makeRule(block, recurrence); nextRule.startDate = cutoff;
          replacementRule = Utils.clone(nextRule);
          s.recurrenceSeries.push(nextRule);
          for (const e of s.recurrenceExceptions.filter(e => e.seriesId === rule.seriesId && e.occurrenceDate >= cutoff)) e.seriesId = nextRule.seriesId;
          for (const b of affected) b.seriesId = nextRule.seriesId;
        }
      } else if (old?.seriesId) {
        RecurrenceService.exception(s, old, remove ? null : block);
      } else {
        if (old) s.calendarBlocks = s.calendarBlocks.filter(b => b.id !== old.id);
        if (!remove) { if (recurrence) s.recurrenceSeries.push(this.makeRule(block, recurrence)); else s.calendarBlocks.push(block); }
      }
      if (loss > 0 || logRule && lossSource.protected && activeBlock(lossSource)) {
        const entry = { id: Utils.id(), date: lossSource.startDateTime.slice(0, 10), weekId: DateUtils.weekId(lossSource.startDateTime.slice(0, 10)), sourceAreaId: lossSource.primaryAreaId, targetAreaId: isWork || dueToWork ? workId : null, minutes: loss, reason, sourceBlockId: block?.id || old.id, sourceSeriesId: old.seriesId || null, createdAt: new Date().toISOString(), resolved: false, resolvedMinutes: 0, resolvedAt: null };
        if (logRule) {
          entry.seriesRule = logRule; entry.replacementRule = replacementRule; entry.occurrenceLosses = {};
          for (const e of state.recurrenceExceptions.filter(e => e.seriesId === old.seriesId && e.occurrenceDate >= logRule.startDate)) entry.occurrenceLosses[e.occurrenceDate] = 0;
          for (const b of state.calendarBlocks.filter(b => b.seriesId === old.seriesId && b.occurrenceDate >= logRule.startDate)) entry.occurrenceLosses[b.occurrenceDate] = 0;
          s.displacementLog.push(entry);
        } else {
          for (const part of ProtectionService.parts(old, remove ? null : block, state)) s.displacementLog.push({ ...entry, ...part, id: Utils.id() });
        }
        notices.push(logRule ? 'Изменяется защищённая серия. Потери рассчитываются отдельно для каждой недели с учётом сохранённых исключений и переносов.' : `${entry.targetAreaId ? 'Работа вытесняет' : 'Освобождается'} ${Utils.formatMinutes(loss)} защищённого времени. ${entry.targetAreaId ? 'Потеря попадёт в журнал поглощения личного времени.' : 'Это не считается поглощением работой.'}`);
      }
      if (logRule && remove) {
        // Материализованные исключения имеют собственные сферы, статусы и длительности.
        for (const before of state.calendarBlocks.filter(b => b.seriesId === old.seriesId && b.occurrenceDate >= logRule.startDate && !s.calendarBlocks.some(x => x.id === b.id))) {
          for (const part of ProtectionService.parts(before, null, state)) s.displacementLog.push({ id: Utils.id(), ...part, sourceAreaId: before.primaryAreaId, targetAreaId: dueToWork ? workId : null, reason, sourceBlockId: before.id, sourceSeriesId: before.seriesId, createdAt: new Date().toISOString(), resolvedMinutes: 0, resolved: false });
        }
      }
      // Задача привязывается к конкретному экземпляру; повторение не создаёт бесконечных ссылок.
      if (!old && recurrence && block && (block.taskIds?.length || block.sourceInboxId)) {
        const series = s.recurrenceSeries.at(-1), occurrence = RecurrenceService.occurrence(series, series.startDate);
        series.template.taskIds = []; delete series.template.sourceInboxId;
        block.seriesId = series.seriesId; block.occurrenceDate = series.startDate;
        RecurrenceService.exception(s, occurrence, block);
      }
      TaskService.reconcile(s);
      if (s.uiState.focusTimer?.blockId && !s.calendarBlocks.some(b => b.id === s.uiState.focusTimer.blockId && activeBlock(b))) s.uiState.focusTimer.blockId = null;
      if (block?.sourceInboxId && !remove) { const item = s.brainDumpItems.find(i => i.id === block.sourceInboxId); if (item) Object.assign(item, { convertedBlockId: block.id, processed: true }); }
      if (remove) for (const item of s.brainDumpItems) if (item.convertedBlockId && !s.calendarBlocks.some(b => b.id === item.convertedBlockId)) item.convertedBlockId = null;
      const selectedDate = block?.startDateTime.slice(0, 10) || old.startDateTime.slice(0, 10);
      ReservationService.ensure(s, selectedDate);
      const budget = BudgetService.calculate(s, selectedDate);
      if (!remove && budget.conflict) notices.push(`В этой неделе есть конфликт расписания: ${Utils.formatMinutes(budget.conflict)}. Сохранить план можно, но одновременные обязательства потребуют решения.`);
      if (!remove && budget.overload) notices.push(`Избыточный спрос: ${Utils.formatMinutes(budget.overload)}. Физически занятое время при этом не превышает 168 часов.`);
      if (block && !remove) {
        const energyWarning = EnergyService.warning(block, s); if (energyWarning) notices.push(energyWarning);
        const day = DateUtils.minute(`${selectedDate}T00:00`), daily = BudgetService.calculate(s, selectedDate, [day, day + 1440]);
        if (daily.nonSleep > 960) notices.push('В этот день запланировано более 16 часов нагрузки вне сна.');
        if (isWork && block.plannedMinutes > EnergyService.prefs(s).postureMinutes) notices.push('Длинный рабочий блок: предусмотрена ли пауза для смены положения?');
      }
      s.settings.dataRevision = (s.settings.dataRevision || 0) + 1;
      const affectedWeeks = new Set([originalWeek, DateUtils.weekStart(selectedDate)].filter(Boolean).map(w => DateUtils.weekId(w)));
      for (const item of [old, block].filter(Boolean)) for (let w = DateUtils.weekStart(item.startDateTime.slice(0, 10)); DateUtils.minute(w + 'T00:00') < DateUtils.minute(item.endDateTime); w = DateUtils.add(w, 7)) affectedWeeks.add(DateUtils.weekId(w));
      for (const snap of s.weekSnapshots) if (affectedWeeks.has(snap.weekId)) snap.needsRecalculation = true;
      return { state: s, notices, budget, loss, block };
    },
    lossForOperation(old, next, state) { return ProtectionService.loss(old, next, state); },
    makeRule(block, recurrence) {
      if (!['daily', 'weekly', 'custom'].includes(recurrence.frequency)) throw new Error('Выбери режим повторения.');
      const startDate = block.startDateTime.slice(0, 10), weekdays = recurrence.frequency === 'weekly' ? [DateUtils.weekday(startDate)] : recurrence.weekdays;
      if (recurrence.frequency !== 'daily' && (!weekdays?.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) throw new Error('Выбери дни повторения.');
      if (recurrence.until) { DateUtils.minute(`${recurrence.until}T00:00`); if (recurrence.until < startDate) throw new Error('Окончание серии не может быть раньше её начала.'); }
      return { seriesId: Utils.id(), frequency: recurrence.frequency, weekdays: weekdays || [], interval: 1, startDate, until: recurrence.until || null, template: { ...Utils.clone(block), actualMinutes: null, timerFactBase: 0, timerCredits: {}, status: 'planned' } };
    },
    commit(prepared) { if (Store.blocked) throw new Error('Сохранение заблокировано. Обнови страницу после проверки хранилища.'); Store.change(s => { Object.assign(s, prepared.state); delete s.uiState.blockDraft; }); },
    openWeek(date) { const week = DateUtils.weekStart(date); if (ReservationService.ensure(Store.state, week)) { Store.revision++; Store.save(); } return BudgetService.calculate(Store.state, week); }
  };

  // Вся разметка с данными создаётся узлами; пользовательский HTML не исполняется.
  const TASK_STATUSES = { inbox: 'Входящая', planned: 'Запланирована', in_progress: 'В работе', completed: 'Выполнена', postponed: 'Отложена', cancelled: 'Отменена' };
  const INBOX_CATEGORIES = { task: 'Задача', idea: 'Идея', thought: 'Мысль', worry: 'Беспокойство', decision: 'Решение', event: 'Событие', someday: 'Когда-нибудь' };
  const TaskService = {
    fresh() { return { id: Utils.id(), title: '', areaId: Store.state.lifeAreas.find(a => a.systemType === 'uncategorized').id, blockIds: [], importance: 1, urgency: 1, leverage: 1, energyRequired: 'medium', estimatedMinutes: null, actualMinutes: null, actualMinutesManualOverride: false, deadline: null, status: 'inbox', minimumVersion: '', notes: '', tags: [], createdAt: new Date().toISOString(), completedAt: null }; },
    validate(t, s) {
      if (!t.title?.trim() || t.title.length > 120) throw Error('Название задачи — от 1 до 120 символов.');
      if (!s.lifeAreas.some(a => a.id === t.areaId)) throw Error('Выбери сферу задачи.');
      for (const k of ['importance', 'urgency', 'leverage']) if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 5) throw Error('Важность, срочность и рычаг — от 1 до 5.');
      if (!Object.hasOwn(TASK_STATUSES, t.status) || !Object.hasOwn(ENERGY_NAMES, t.energyRequired)) throw Error('Проверь статус и энергию.');
      if (t.estimatedMinutes !== null && (!Number.isSafeInteger(t.estimatedMinutes) || t.estimatedMinutes <= 0)) throw Error('Оценка — целое положительное число минут или пустое поле.');
      FactService.validate(t.actualMinutes, Number.MAX_SAFE_INTEGER);
      if ((t.notes || '').length > 2000 || (t.minimumVersion || '').length > 500) throw Error('Заметка — до 2000, минимальная версия — до 500 символов.');
      if (!Array.isArray(t.tags) || t.tags.length > 10 || t.tags.some(x => !x.trim() || x.length > 30)) throw Error('До 10 тегов, каждый от 1 до 30 символов.');
      if (t.deadline) DateUtils.minute(`${t.deadline}T00:00`);
      return t;
    },
    save(task, sourceId) {
      this.validate(task, Store.state);
      if (sourceId && Store.state.brainDumpItems.find(x => x.id === sourceId)?.convertedTaskId) throw Error('Эта запись уже преобразована в задачу.');
      Store.change(s => { const old = s.tasks.find(t => t.id === task.id); const t = { ...Utils.clone(task), title: task.title.trim(), blockIds: old?.blockIds || [], completedAt: task.status === 'completed' ? old?.completedAt || new Date().toISOString() : null }; if (old) Object.assign(old, t); else s.tasks.push(t); if (sourceId) { const item = s.brainDumpItems.find(x => x.id === sourceId); if (item) Object.assign(item, { convertedTaskId: t.id, processed: true }); } delete s.uiState.taskDraft; });
    },
    status(id, status) { const t = Store.state.tasks.find(t => t.id === id); this.save({ ...t, status }); },
    remove(id) { Store.change(s => { s.tasks = s.tasks.filter(t => t.id !== id); if (s.uiState.focusTimer?.taskId === id) s.uiState.focusTimer.taskId = null; for (const b of s.calendarBlocks) b.taskIds = (b.taskIds || []).filter(x => x !== id); for (const r of s.recurrenceSeries) r.template.taskIds = (r.template.taskIds || []).filter(x => x !== id); for (const f of s.focusSessions) if (f.taskId === id) f.taskId = null; for (const i of s.brainDumpItems) if (i.convertedTaskId === id) i.convertedTaskId = null; delete s.uiState.taskDraft; }); },
    reconcile(s) {
      const ids = new Set(s.tasks.map(t => t.id));
      for (const b of s.calendarBlocks) b.taskIds = [...new Set(b.taskIds || [])].filter(id => ids.has(id));
      for (const t of s.tasks) {
        const previous = (t.blockIds || []).length;
        t.blockIds = s.calendarBlocks.filter(b => activeBlock(b) && b.taskIds?.includes(t.id)).map(b => b.id);
        if (!previous && t.blockIds.length && t.status === 'inbox') t.status = 'planned';
        else if (previous && !t.blockIds.length && t.status === 'planned') t.status = 'inbox';
      }
    },
    links(id, blocks) {
      Store.change(s => {
        for (const b of s.calendarBlocks) b.taskIds = (b.taskIds || []).filter(x => x !== id);
        for (const candidate of blocks.filter(activeBlock)) {
          let b = s.calendarBlocks.find(b => b.id === candidate.id);
          if (!b) { b = { ...Utils.clone(candidate), id: Utils.id(), virtual: undefined }; RecurrenceService.exception(s, candidate, b); b = s.calendarBlocks.find(x => x.id === b.id); }
          b.taskIds = [...new Set([...(b.taskIds || []), id])];
        }
        this.reconcile(s);
      });
    }
  };
  const InboxService = {
    add(text, split, category) {
      const lines = (split ? text.split(/\r?\n/) : [text]).map(x => x.trim()).filter(Boolean);
      if (!lines.length || lines.some(x => x.length > 2000)) throw Error('Каждая запись — от 1 до 2000 символов.');
      if (!Object.hasOwn(INBOX_CATEGORIES, category)) throw Error('Выбери категорию.');
      Store.change(s => { s.brainDumpItems.push(...lines.map(text => ({ id: Utils.id(), text, category, processed: false, createdAt: new Date().toISOString(), convertedTaskId: null, convertedBlockId: null }))); delete s.uiState.inboxDraft; });
    },
    update(id, changes) { const item = { ...Store.state.brainDumpItems.find(i => i.id === id), ...changes }; if (!item.text?.trim() || item.text.length > 2000 || !Object.hasOwn(INBOX_CATEGORIES, item.category)) throw Error('Проверь текст (до 2000 символов) и категорию.'); Store.change(s => { Object.assign(s.brainDumpItems.find(i => i.id === id), item); delete s.uiState.inboxEditDraft; }); },
    remove(id) { Store.change(s => { s.brainDumpItems = s.brainDumpItems.filter(i => i.id !== id); delete s.uiState.inboxEditDraft; }); }
  };
  const FactService = {
    dayReservations(s, date) {
      const lo = DateUtils.minute(`${date}T00:00`), rows = [...s.capacityReservations];
      for (const f of s.reservationFacts || []) if (!rows.some(r => r.id === f.reservationId)) rows.push({ id: f.reservationId, type: f.type, startDateTime: f.planStartDateTime, endDateTime: f.planEndDateTime, savedFact: true });
      return rows.filter(r => r.type !== 'sleep' && Intervals.clip(Intervals.of(r), lo, lo + 1440));
    },
    validate(value, max = 1440) { if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > max)) throw Error(`Факт — целое число от 0 до ${max} минут или пустое поле.`); },
    reservation(id, mode, start, end) {
      const saved = Store.state.reservationFacts?.find(f => f.reservationId === id);
      const r = Store.state.capacityReservations.find(r => r.id === id) || (saved && { id, type: saved.type, startDateTime: saved.planStartDateTime, endDateTime: saved.planEndDateTime }); if (!r || r.type === 'sleep') throw Error('Рабочий резерв не найден.');
      if (![null, 'planned_as_actual', 'manual'].includes(mode)) throw Error('Выбери способ фиксации.');
      const a = mode === 'planned_as_actual' ? r.startDateTime : start, b = mode === 'planned_as_actual' ? r.endDateTime : end;
      const minutes = mode ? DateUtils.minute(b) - DateUtils.minute(a) : null; this.validate(minutes);
      Store.change(s => { s.reservationFacts ||= []; s.reservationFacts = s.reservationFacts.filter(f => f.reservationId !== id); if (mode) s.reservationFacts.push({ reservationId: id, type: r.type, planStartDateTime: r.startDateTime, planEndDateTime: r.endDateTime, actualStartDateTime: a, actualEndDateTime: b, actualMinutes: minutes, factStatus: mode }); const affected = [r.startDateTime, r.endDateTime, a, b, saved?.actualStartDateTime, saved?.actualEndDateTime].filter(Boolean).map(x => DateUtils.weekId(x.slice(0, 10))); for (const snap of s.weekSnapshots) if (affected.includes(snap.weekId)) snap.needsRecalculation = true; });
    },
    portion(b, bounds, excluded = []) {
      if (b.actualMinutes == null) return null;
      if (b.timerCredits && Object.keys(b.timerCredits).length) {
        let value = this.portion({ ...b, timerCredits: null, actualMinutes: b.timerFactBase || 0 }, bounds, excluded) || 0;
        const realBounds = bounds.map(n => +new Date(DateUtils.stamp(n))), realExcluded = excluded.map(pair => pair.map(n => +new Date(DateUtils.stamp(n))));
        for (const credit of Object.values(b.timerCredits)) {
          if (!excluded.length && bounds[1] - bounds[0] === 10080) { value += credit.weekMinutes[DateUtils.weekId(DateUtils.stamp(bounds[0]).slice(0, 10))] || 0; continue; }
          const total = credit.segments.reduce((n, p) => n + p.end - p.start, 0);
          const included = credit.segments.reduce((n, p) => { const part = Intervals.clip([p.start, p.end], ...realBounds); return n + (part ? part[1] - part[0] - Intervals.length(realExcluded.map(x => Intervals.clip(x, ...part))) : 0); }, 0);
          value += total ? credit.minutes * included / total : 0;
        }
        return value;
      }
      const full = Intervals.of(b), part = Intervals.clip(full, ...bounds);
      if (!part) return 0;
      const covered = Intervals.length(excluded.map(x => Intervals.clip(x, ...part)));
      return b.actualMinutes * Math.max(0, part[1] - part[0] - covered) / (full[1] - full[0]);
    },
    calculate(s, date) {
      const week = DateUtils.weekStart(date), bounds = DateUtils.bounds(week), budget = BudgetService.calculate(s, week);
      const withCredits = s.calendarBlocks.filter(b => Object.values(b.timerCredits || {}).some(c => Object.hasOwn(c.weekMinutes, DateUtils.weekId(week))));
      const blocks = [...new Map([...RecurrenceService.blocks(s, week, DateUtils.add(week, 6)), ...withCredits].map(b => [b.id, b])).values()].filter(activeBlock);
      const facts = (s.reservationFacts || []).filter(f => f.factStatus && (Intervals.clip([DateUtils.minute(f.actualStartDateTime), DateUtils.minute(f.actualEndDateTime)], ...bounds) || Intervals.clip([DateUtils.minute(f.planStartDateTime), DateUtils.minute(f.planEndDateTime)], ...bounds)));
      const spans = type => Intervals.union(facts.filter(f => f.type === type).map(f => Intervals.clip([DateUtils.minute(f.actualStartDateTime), DateUtils.minute(f.actualEndDateTime)], ...bounds)));
      const workId = s.lifeAreas.find(a => a.systemType === 'work').id, workBlocks = blocks.filter(b => b.primaryAreaId === workId), workSpans = spans('work');
      const workKnown = facts.some(f => f.type === 'work') || workBlocks.some(b => b.actualMinutes != null);
      const work = workKnown ? Math.round(Intervals.length(workSpans) + workBlocks.reduce((n, b) => n + (this.portion(b, bounds, workSpans) || 0), 0)) : null;
      const commute = facts.some(f => f.type === 'commute') ? Intervals.length(spans('commute')) : null;
      const missing = budget.reserves.filter(r => r.type !== 'sleep').some(r => !facts.some(f => f.reservationId === r.id));
      const contributions = {}, counts = {};
      for (const b of blocks) for (const id of new Set([b.primaryAreaId, ...(b.additionalAreaIds || [])])) { counts[id] ||= { known: 0, total: 0 }; counts[id].total++; if (b.actualMinutes != null) { counts[id].known++; contributions[id] = (contributions[id] || 0) + this.portion(b, bounds); } }
      for (const id of Object.keys(contributions)) contributions[id] = Math.round(contributions[id]);
      const planCommute = Intervals.length(budget.reserves.filter(r => r.type === 'commute').map(Intervals.of));
      return { work, commute, partial: missing || workBlocks.some(b => b.actualMinutes == null && this.portion({ ...b, actualMinutes: b.plannedMinutes }, bounds, workSpans) > 0), contributions, counts, planPercent: budget.waking ? Math.max(0, budget.waking - budget.work - planCommute) / budget.waking * 100 : null, factPercent: work === null || !budget.waking ? null : Math.max(0, budget.waking - work - (commute || 0)) / budget.waking * 100 };
    }
  };
  const SearchService = {
    matches(item, kind, filters = {}) {
      const text = [item.title, item.text, item.notes, item.note, item.minimumVersion, ...(item.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase('ru');
      if (filters.query && !text.includes(filters.query.trim().toLocaleLowerCase('ru'))) return false;
      if (kind !== 'inbox') {
        if (filters.area && ![item.areaId, item.primaryAreaId, ...(item.additionalAreaIds || [])].includes(filters.area)) return false;
        if (filters.status && item.status !== filters.status || filters.energy && item.energyRequired !== filters.energy) return false;
        if (filters.done && (item.status === 'completed') !== (filters.done === 'yes')) return false;
      } else {
        if (filters.category && item.category !== filters.category) return false;
        if (filters.archive !== 'all' && Boolean(item.processed) !== (filters.archive === 'yes')) return false;
      }
      if (filters.date) {
        if (kind === 'blocks') { const lo = DateUtils.minute(`${filters.date}T00:00`); if (!Intervals.clip(Intervals.of(item), lo, lo + 1440)) return false; }
        else if ((kind === 'tasks' ? item.deadline : item.createdAt?.slice(0, 10)) !== filters.date) return false;
      }
      return true;
    }
  };

  const EnergyService = {
    prefs(s = Store.state) { return { sound: false, browserNotifications: false, postureEnabled: false, postureMinutes: 50, energyProfile: {}, ...(s.settings.focusPreferences || {}) }; },
    period(hour) { return hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; },
    set(date, value) { DateUtils.minute(`${date}T00:00`); if (value && !Object.hasOwn(ENERGY_NAMES, value)) throw Error('Выбери уровень энергии.'); Store.change(s => { s.dailyEnergy ||= {}; if (value) s.dailyEnergy[date] = value; else delete s.dailyEnergy[date]; }); },
    warning(b, s = Store.state) { const date = b.startDateTime.slice(0, 10), period = this.period(Number(b.startDateTime.slice(11, 13))), high = b.energyRequired === 'high' || (b.taskIds || []).some(id => s.tasks.find(t => t.id === id)?.energyRequired === 'high'); return high && (s.dailyEnergy?.[date] === 'low' || this.prefs(s).energyProfile[period] === 'low') ? 'Высокая требуемая энергия совпадает с низкой энергией дня или периода. Можно выбрать другое время или минимальную версию задачи.' : ''; }
  };
  const FocusService = {
    scopeArea(t, s = Store.state) { return t.areaId || s.calendarBlocks.find(b => b.id === t.blockId)?.primaryAreaId || s.tasks.find(x => x.id === t.taskId)?.areaId || s.lifeAreas.find(a => a.systemType === 'uncategorized').id; },
    writable() { if (Store.blocked) throw Error('Сохранение заблокировано. Сохрани резервную копию и обнови страницу.'); },
    timer(s = Store.state) { return s.uiState.focusTimer; },
    elapsed(t, now = Date.now()) { return Math.min(t.durationMs, (t.elapsedMs || 0) + (t.status === 'running' ? Math.max(0, now - t.runStartedAt) : 0)); },
    choices(taskId, date = Utils.localDate(), s = Store.state) { const task = s.tasks.find(t => t.id === taskId), all = s.calendarBlocks.filter(b => task?.blockIds?.includes(b.id) && activeBlock(b)), today = all.filter(b => b.startDateTime.slice(0, 10) === date); return today.length === 1 ? today : all; },
    start({ taskId = null, blockId, areaId = null, workMinutes, breakMinutes, longBreakMinutes }, now = Date.now()) {
      this.writable();
      if (this.timer()?.status && this.timer().status !== 'stopped') throw Error('Сначала заверши или останови текущую сессию.');
      for (const n of [workMinutes, breakMinutes, longBreakMinutes]) if (!Number.isInteger(n) || n < 1 || n > 1440) throw Error('Интервалы — от 1 до 1440 целых минут.');
      if (taskId && !Store.state.tasks.some(t => t.id === taskId)) throw Error('Задача не найдена.');
      const choices = this.choices(taskId, Utils.localDate(new Date(now)));
      if (blockId === undefined && choices.length > 1) throw Error('Выбери конкретный блок или «Без привязки к блоку».');
      if (blockId === undefined) blockId = choices.length === 1 && choices[0].startDateTime.slice(0, 10) === Utils.localDate(new Date(now)) ? choices[0].id : null;
      const b = blockId && Store.state.calendarBlocks.find(b => b.id === blockId);
      if (blockId && (!b || !activeBlock(b))) throw Error('Активный блок не найден.');
      if (b && taskId && !b.taskIds?.includes(taskId)) throw Error('Выбранная задача не связана с этим блоком.');
      if (b && !taskId && b.taskIds?.length === 1) taskId = b.taskIds[0];
      areaId = b?.primaryAreaId || Store.state.tasks.find(t => t.id === taskId)?.areaId || areaId || Store.state.lifeAreas.find(a => a.systemType === 'uncategorized').id;
      if (!Store.state.lifeAreas.some(a => a.id === areaId)) throw Error('Выбери сферу фокуса.');
      Store.change(s => { s.uiState.focusTimer = { id: Utils.id(), phase: 'work', status: 'running', taskId, areaId, blockId: blockId || null, workMinutes, breakMinutes, longBreakMinutes, durationMs: workMinutes * 60000, elapsedMs: 0, runStartedAt: now, startedAt: new Date(now).toISOString(), segments: [], completedCycles: 0, postureNotified: false }; const t = s.tasks.find(t => t.id === taskId); if (t) { t.status = 'in_progress'; t.completedAt = null; } });
    },
    checkpoint(t, now) { if (t.status !== 'running') return; const end = Math.min(now, t.runStartedAt + t.durationMs - t.elapsedMs); if (end > t.runStartedAt) t.segments.push({ start: t.runStartedAt, end }); t.elapsedMs = this.elapsed(t, now); t.runStartedAt = null; },
    pause(now = Date.now()) { const t = this.timer(); if (!t || t.status !== 'running') return; if (this.elapsed(t, now) >= t.durationMs) return this.finish(now); Store.change(s => { const x = this.timer(s); this.checkpoint(x, now); x.status = 'paused'; }); },
    resume(now = Date.now()) { const t = this.timer(); if (!t || t.status !== 'paused') return; Store.change(s => { const x = this.timer(s); x.runStartedAt = now; x.status = 'running'; }); },
    allocate(segments, minutes) {
      const amounts = {};
      for (const part of segments) { let cursor = part.start; while (cursor < part.end) { const local = new Date(cursor), week = Utils.mondayForDate ? Utils.mondayForDate(local) : DateUtils.weekStart(Utils.localDate(local)); const next = new Date(local); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() + (8 - (next.getDay() || 7))); const end = Math.min(part.end, +next); const key = DateUtils.weekId(week); amounts[key] = (amounts[key] || 0) + end - cursor; cursor = end; } }
      const total = Object.values(amounts).reduce((a, b) => a + b, 0), rows = Object.entries(amounts).map(([weekId, ms]) => ({ weekId, raw: total ? ms / total * minutes : 0 })); let left = minutes - rows.reduce((n, r) => n + Math.floor(r.raw), 0); rows.sort((a, b) => (b.raw % 1) - (a.raw % 1)); return Object.fromEntries(rows.map(r => [r.weekId, Math.floor(r.raw) + (left-- > 0 ? 1 : 0)]));
    },
    taskActual(id, s = Store.state) { const sessions = s.focusSessions.filter(f => f.taskId === id && f.kind === 'work' && f.completed); return sessions.length ? sessions.reduce((n, f) => n + f.actualMinutes, 0) : null; },
    useTimer(id) { this.writable(); Store.change(s => { const t = s.tasks.find(t => t.id === id); if (t) { t.actualMinutesManualOverride = false; t.actualMinutes = this.taskActual(id, s); } }); },
    finish(now = Date.now(), stop = false) {
      this.writable();
      const current = this.timer(); if (!current || !['running', 'paused'].includes(current.status)) { if (stop && current) Store.change(s => { s.uiState.focusTimer.status = 'stopped'; }); return null; }
      let event;
      Store.change(s => {
        const t = this.timer(s); this.checkpoint(t, now);
        if (t.phase === 'work') {
          const minutes = Math.floor(t.elapsedMs / 60000), weekMinutes = this.allocate(t.segments, minutes);
          if (!s.focusSessions.some(f => f.id === t.id)) {
            const session = { id: t.id, kind: 'work', completed: true, startedAt: t.startedAt, endedAt: new Date(t.segments.at(-1)?.end || now).toISOString(), taskId: t.taskId, blockId: t.blockId, areaId: this.scopeArea(t, s), actualMinutes: minutes, workedMs: t.elapsedMs, segments: Utils.clone(t.segments), weekMinutes };
            s.focusSessions.push(session);
            const task = s.tasks.find(x => x.id === t.taskId); if (task && !task.actualMinutesManualOverride) task.actualMinutes = this.taskActual(task.id, s);
            const block = s.calendarBlocks.find(b => b.id === t.blockId);
            if (block) { block.timerFactBase ??= block.actualMinutes || 0; block.timerCredits ||= {}; const credited = Math.max(0, Math.min(minutes, 1440 - (block.actualMinutes || 0))); block.timerCredits[t.id] = { minutes: credited, weekMinutes: this.allocate(t.segments, credited), segments: Utils.clone(t.segments) }; block.actualMinutes = Math.min(1440, block.timerFactBase + Object.values(block.timerCredits).reduce((n, c) => n + c.minutes, 0)); }
            s.settings.dataRevision = (s.settings.dataRevision || 0) + 1;
            for (const snap of s.weekSnapshots) if (Object.hasOwn(weekMinutes, snap.weekId)) { snap.needsRecalculation = true; snap.sourceDataRevision = (snap.sourceDataRevision || 0) + 1; }
          }
          t.completedCycles++; t.phase = 'break'; t.durationMs = (t.completedCycles % 4 === 0 ? t.longBreakMinutes : t.breakMinutes) * 60000; event = 'Рабочий интервал завершён. Время для отдыха.';
        } else { t.phase = 'work'; t.durationMs = t.workMinutes * 60000; event = 'Перерыв завершён. Следующий цикл можно начать, когда будешь готов.'; }
        Object.assign(t, { id: Utils.id(), status: stop ? 'stopped' : 'ready', elapsedMs: 0, runStartedAt: null, segments: [], postureNotified: false });
      }); return event;
    },
    next(now = Date.now()) { const t = this.timer(); if (!t || t.status !== 'ready') return; Store.change(s => { const x = this.timer(s); Object.assign(x, { status: 'running', runStartedAt: now, startedAt: new Date(now).toISOString(), elapsedMs: 0, segments: [] }); }); },
    skipBreak() { const t = this.timer(); if (!t || t.phase !== 'break') return; Store.change(s => Object.assign(this.timer(s), { phase: 'work', status: 'ready', durationMs: t.workMinutes * 60000, elapsedMs: 0, runStartedAt: null, segments: [], postureNotified: false })); },
    tick(now = Date.now()) { const t = this.timer(); if (Store.blocked || !t || t.status !== 'running') return []; const events = []; const p = EnergyService.prefs(); if (t.phase === 'work' && p.postureEnabled && !t.postureNotified && this.elapsed(t, now) >= p.postureMinutes * 60000) { Store.change(s => { this.timer(s).postureNotified = true; }); events.push('Пора сменить положение или предусмотреть короткую паузу.'); } if (this.elapsed(t, now) >= t.durationMs) events.push(this.finish(now)); return events.filter(Boolean); }
  };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'open') node[key] = Boolean(value);
      else if (value !== undefined && value !== null) node.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  const button = (text, action, className = '', attrs = {}) => el('button', { type: 'button', class: `button ${className}`, onclick: action, ...attrs }, text);
  const field = (label, control, hint) => { const target = control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea'); if (target && !target.hasAttribute('aria-label')) target.setAttribute('aria-label', label); return el('label', { class: 'field' }, el('span', {}, label), control, hint ? el('small', {}, hint) : null); };
  const input = (name, value, type = 'text', extra = {}) => el('input', { name, type, value: value ?? '', ...extra });
  function select(name, value, choices) { const n = el('select', { name }, choices.map(([v, label]) => el('option', { value: v }, label))); n.value = value; return n; }
  function check(label, name, checked, onChange) { const c = input(name, 'yes', 'checkbox', { checked }); if (onChange) c.addEventListener('change', onChange); return el('label', { class: 'check' }, c, el('span', {}, label)); }
  function days(name, selected) { return el('div', { class: 'days', role: 'group', 'aria-label': 'Дни недели' }, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, i) => el('label', { class: 'day' }, input(name, i + 1, 'checkbox', { checked: selected.includes(i + 1), 'aria-label': ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][i] }), el('span', {}, label)))); }
  function download(content, name) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backup(raw = false) { download(raw ? (Store.raw ?? '') : Store.snapshot(), raw ? `life168-исходные-данные-${Utils.localDate()}.json` : `life168-резервная копия-${Utils.localDate()}.json`); }
  const AreaIcons = {
    key(area) {
      const legacy = { 'Культура': ['circle', 'venus'], 'Собаки / прогулки': ['sun', 'paw'], 'Творчество': ['star', 'palette'], 'Отдых и восстановление': ['leaf', 'moon'] }[area.name];
      return legacy && area.icon === legacy[0] ? legacy[1] : area.icon;
    },
    paths: {
      leaf: ['M12 35C7 22 15 10 37 9C39 29 29 39 12 35Z', 'M10 40L31 17M19 30L18 21M24 25L33 25'],
      heart: ['M24 39C19 34 7 26 7 17C7 7 20 6 24 16C28 6 41 7 41 17C41 26 29 34 24 39Z', 'M13 17C13 13 17 12 19 14'],
      circle: ['M39 24A15 15 0 1 1 24 9', 'M24 5V13M20 9H28', 'M18 24L23 29L32 19'],
      star: ['M24 6L29 18L42 24L29 29L24 42L19 29L6 24L19 18Z', 'M34 7L35 11L39 12L35 13L34 17L33 13L29 12L33 11Z'],
      book: ['M24 13C18 9 11 9 5 11V36C12 34 18 34 24 39C30 34 36 34 43 36V11C37 9 30 9 24 13V39', 'M10 17C14 16 17 17 20 19M10 24C14 23 17 24 20 26M29 19C32 17 35 16 38 17'],
      home: ['M6 23L24 8L42 23M11 20V40H37V20', 'M20 40V29H28V40M18 19H20M28 19H30'],
      sun: ['M33 24A9 9 0 1 1 15 24A9 9 0 1 1 33 24', 'M24 4V9M24 39V44M4 24H9M39 24H44M10 10L14 14M34 34L38 38M10 38L14 34M34 14L38 10'],
      work: ['M7 17H41V39H7ZM17 17V11H31V17', 'M7 24C17 30 31 30 41 24M21 25H27V31H21Z'],
      path: ['M11 42C7 31 30 31 24 20C20 14 34 12 34 6', 'M17 42C13 33 38 33 31 20C27 14 40 13 40 6', 'M35 7L38 3L42 7'],
      venus: ['M23 5C18 5 18 14 23 15C28 16 30 7 26 5Z', 'M22 15L21 18L15 20L12 25L16 27L18 24C17 29 19 31 17 35L14 43H34L31 35C29 30 31 27 31 23L35 25L37 21L29 18L27 15', 'M18 29C21 32 27 31 31 28M19 32L28 35L21 42M29 33L30 42M16 40L19 36', 'M13 44H35M19 9C21 8 22 6 25 6'],
      paw: ['M24 23C20 23 18 28 14 31C8 38 16 42 24 38C32 42 40 38 34 31C30 28 28 23 24 23Z', 'M16 15C16 9 9 9 9 15C9 22 16 22 16 15ZM25 10C25 3 18 3 18 10C18 17 25 17 25 10ZM34 12C36 5 29 4 27 11C25 18 32 19 34 12ZM41 21C44 14 37 12 35 18C32 24 38 27 41 21Z'],
      palette: ['M25 6C12 6 5 15 5 27C5 40 18 44 23 38C26 35 20 31 23 28C27 24 33 33 39 28C47 21 39 6 25 6Z', 'M15 17H15.1M24 13H24.1M34 17H34.1M12 27H12.1', 'M28 43L42 31'],
      moon: ['M32 6C17 8 21 31 38 29C29 47 5 34 10 18C13 9 22 5 32 6Z', 'M36 8L38 13L43 15L38 17L36 22L34 17L29 15L34 13Z']
    },
    render(area) {
      const key = this.key(area), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 48 48', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.45', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `area-illustration icon-${key}`, 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
      for (const d of this.paths[key] || this.paths.circle) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
      return svg;
    }
  };
  const UI = {
    confirmHistory(date, save, back) {
      if (DateUtils.weekStart(date) >= Utils.monday()) { save(); return; }
      UI.open('Изменить завершённую неделю?', el('div', {}, el('p', {}, 'Ты меняешь данные прошлой недели. Её аналитика будет пересчитана после подтверждения.'), el('div', { class: 'actions' }, button('Отмена', back), button('Подтвердить пересчёт', save, 'primary'))));
    },
    toast(message) { const n = el('div', { class: 'toast' }, message); document.querySelector('#notifications').append(n); setTimeout(() => n.remove(), 4500); },
    status() {
      const n = document.querySelector('#save-status'); if (!n) return;
      n.textContent = Store.blocked ? 'Хранение недоступно' : Store.lastError ? 'Не сохранено' : Store.revision === Store.savedRevision ? 'Сохранено в браузере' : 'Сохраняем черновик…';
      const warning = document.querySelector('#storage-warning');
      const warningKey = `${Store.lastError}|${Store.bytes >= SOFT_LIMIT * .7}|${Store.blocked}`;
      if (warning.dataset.message === warningKey) return;
      warning.dataset.message = warningKey;
      warning.replaceChildren();
      warning.hidden = !(Store.lastError || Store.bytes >= SOFT_LIMIT * .7);
      if (!warning.hidden) warning.append(el('div', {}, Store.lastError || 'Данные занимают более 70% мягкого лимита 3 МБ. Сохрани резервную копию. История не удаляется автоматически.'), el('div', { class: 'actions' }, button('Скачать резервную копию', () => backup(Store.blocked && Store.raw !== null), 'small'), !Store.blocked ? button('Повторить сохранение', () => { Store.save(); }, 'small') : null));
    },
    open(title, body) {
      const dialog = document.querySelector('#modal'); if (dialog.open) dialog.close();
      dialog.replaceChildren(el('div', { class: 'modal-inner' }, el('div', { class: 'modal-header' }, el('h2', { id: 'modal-title' }, title), el('button', { class: 'close-button', type: 'button', 'aria-label': 'Закрыть окно', onclick: () => UI.close() }, '×')), body));
      dialog.showModal();
    },
    close() { Store.save(); document.querySelector('#modal').close(); },
    heading(title, subtitle, action) { return el('div', { class: 'page-heading' }, el('div', {}, el('p', { class: 'eyebrow' }, 'ПРОСТРАНСТВО ДЛЯ ЖИЗНИ'), el('h1', {}, title), el('p', { class: 'subtitle' }, subtitle)), action || null); },
    navigate(id) { if (Store.blocked) return; Store.change(s => { s.uiState.activeSection = id; }); UI.render(); },
    render() {
      const nav = document.querySelector('#navigation'); nav.replaceChildren();
      SECTIONS.forEach(([id, label, icon]) => nav.append(el('button', { type: 'button', class: 'nav-button', ...(Store.state.uiState.activeSection === id ? { 'aria-current': 'page' } : {}), onclick: () => UI.navigate(id) }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), el('span', {}, label))));
      document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
      const main = document.querySelector('#main'); main.replaceChildren();
      if (Store.blocked) { this.recovery(main); return; }
      if (Store.state.weekSnapshots.some(s => s.needsRecalculation)) { AnalyticsService.sync(Store.state); Store.revision++; Store.save(); }
      const section = Store.state.uiState.activeSection;
      main.append(el('div', { class: 'global-search' }, button('Поиск по всем разделам', () => WorkUI.search(), 'small')));
      if (section === 'areas') this.areas(main);
      else if (section === 'settings') this.settings(main);
      else if (section === 'week' || section === 'budget') CalendarUI.render(main, section);
      else if (section === 'tasks' || section === 'inbox') WorkUI.render(main, section);
      else if (section === 'focus') FocusUI.render(main);
      else if (section === 'analytics') AnalyticsUI.render(main);
      else this.placeholder(main, section);
      if (section === 'settings') { FocusUI.preferences(main); AnalyticsUI.transfers(main); }
      this.status();
    },
    placeholder(main, section) {
      const label = SECTIONS.find(([id]) => id === section)[1];
      const intro = section === 'week';
      main.append(this.heading(label, intro ? 'Неделя начинается с того, чему ты хочешь отдать своё время.' : 'Этот раздел появится на следующем этапе разработки.'));
      if (intro) {
        main.append(el('section', { class: 'panel hero' }, el('div', {}, el('p', { class: 'eyebrow' }, '168 ЧАСОВ. ОДНА ЖИЗНЬ.'), el('h2', {}, 'Оставь место для того,', el('br'), 'что действительно важно.'), el('p', { class: 'subtitle' }, 'Начни со своих сфер жизни и привычного ритма. Календарь и расчёт недельного бюджета — следующий шаг.'), el('div', { class: 'actions' }, button('Мои сферы жизни →', () => UI.navigate('areas'), 'primary'), button('Настроить ритм', () => UI.navigate('settings'), 'subtle'))), el('div', { class: 'hero-figure', 'aria-hidden': 'true' }, el('div', { class: 'hero-number' }, '168'), el('small', {}, 'ЧАСОВ В ТВОЕЙ НЕДЕЛЕ'))));
        const areas = Store.state.lifeAreas.filter(a => !a.hidden);
        main.append(el('div', { class: 'stat-grid' }, this.stat('Сферы жизни', areas.length, 'выбрано тобой'), this.stat('Защищённые сферы', areas.filter(a => a.protected).length, 'защита для новых блоков'), this.stat('Режим фокуса', `${Store.state.settings.focus.workMinutes} / ${Store.state.settings.focus.breakMinutes}`, 'минут работы / перерыва')));
      }
      main.append(el('section', { class: 'panel empty', style: 'margin-top:22px' }, el('span', { class: 'pill lavender' }, 'Разработка · готовы шаги 1–4'), el('h2', {}, `${label} — впереди`), el('p', { class: 'subtitle' }, 'Работают календарь, бюджет, задачи, входящие, ручной факт, таймер и энергия. Расширенная аналитика появится на следующем этапе.'), button('Моя неделя', () => UI.navigate('week'))));
    },
    stat(label, value, hint) { return el('div', { class: 'stat' }, el('p', {}, label), el('strong', {}, value), el('p', {}, hint)); },
    normTotals(areas) {
      return el('section', { class: 'norm-totals', 'aria-label': 'Сумма ориентиров всех активных сфер', 'aria-live': 'polite' },
        el('div', { class: 'stat-grid' }, AreaService.totals(areas).map((item, i) => el('div', { class: `stat ${item.over ? 'over-target' : ''}`, 'data-total': item.key }, el('p', {}, ['Сумма минимумов', 'Сумма комфорта', 'Сумма максимумов'][i]), el('strong', {}, item.count ? Utils.formatMinutes(item.minutes) : 'Не заданы'), el('p', {}, item.over ? `Выше 168 ч на ${Utils.formatMinutes(item.over)}` : item.count ? `До 168 ч: ${Utils.formatMinutes(10080 - item.minutes)}` : 'Можно указать позже')))),
        el('p', { class: 'hint', style: 'margin:12px 0 18px' }, 'Сумма ориентиров активных сфер, а не физический бюджет: совместное занятие может поддерживать несколько сфер. Сон и другие резервы считаются отдельно в календаре. Превышение не мешает сохранить ориентиры.'));
    },
    areas(main) {
      main.append(this.heading('Сферы жизни', 'У каждой важной части жизни — своё место. Выбери ориентиры, которые подходят тебе.', button('+ Добавить сферу', () => UI.areaEditor(), 'primary')));
      main.append(el('div', { class: 'filter-bar' }, el('span', { class: 'hint' }, `${Store.state.lifeAreas.filter(a => !a.hidden).length} активных сфер · нормативы в часах за неделю`), check('Показать скрытые', 'showHidden', Store.state.uiState.showHidden, e => { Store.change(s => { s.uiState.showHidden = e.target.checked; }); UI.render(); })));
      main.append(UI.normTotals(Store.state.lifeAreas));
      if (Store.state.uiState.areaDraft) main.append(el('div', { class: 'panel' }, el('p', { class: 'hint' }, 'Есть сохранённый черновик сферы.'), button('Продолжить редактирование', () => UI.areaEditor(Store.state.uiState.areaDraft.id), 'small')));
      const grid = el('div', { class: 'area-grid' }); const list = AreaService.ordered();
      list.filter(a => Store.state.uiState.showHidden || !a.hidden).forEach(a => {
        const i = list.findIndex(x => x.id === a.id);
        grid.append(el('article', { class: `area-card ${a.hidden ? 'hidden-area' : ''}`, 'aria-label': a.name },
          el('div', { class: 'area-card-top' }, el('span', { class: 'area-symbol', style: `background:${a.color}`, 'aria-hidden': 'true' }, AreaIcons.render(a)), el('div', {}, el('h3', {}, a.name), el('div', { class: 'area-meta' }, a.protected ? el('span', { class: 'pill' }, '◇ Защищённая') : null, a.systemType ? el('span', { class: 'pill lavender' }, 'Системная') : null, a.hidden ? el('span', { class: 'pill' }, 'Скрыта') : null))),
          el('dl', { class: 'norms' }, [['minimumHours', 'Минимум'], ['comfortHours', 'Комфорт'], ['maximumHours', 'Максимум']].map(([key, text]) => el('div', {}, el('dt', {}, text), el('dd', {}, a[key] === null ? '—' : `${a[key]} ч`)))),
          a.description ? el('p', { class: 'hint', style: 'margin-bottom:15px;overflow-wrap:anywhere' }, a.description) : null,
          el('div', { class: 'area-card-actions' }, button('Изменить', () => UI.areaEditor(a.id), 'small'), el('div', { class: 'order-buttons' }, button('↑', () => { AreaService.move(a.id, -1); UI.render(); }, 'small', { 'aria-label': `Поднять ${a.name}`, disabled: i === 0 }), button('↓', () => { AreaService.move(a.id, 1); UI.render(); }, 'small', { 'aria-label': `Опустить ${a.name}`, disabled: i === list.length - 1 })))));
      });
      main.append(grid);
      if (!grid.childElementCount) main.append(el('section', { class: 'panel empty' }, el('h2', {}, 'Все сферы скрыты'), el('p', { class: 'subtitle' }, 'Включи показ скрытых сфер, чтобы вернуть нужные.'), button('Показать скрытые', () => { Store.change(s => { s.uiState.showHidden = true; }); UI.render(); })));
    },
    areaEditor(id) {
      const existing = Store.state.lifeAreas.find(a => a.id === id);
      const draft = Store.state.uiState.areaDraft;
      const a = Utils.clone(draft && draft.id === id ? draft : existing || { id: Utils.id(), name: '', icon: 'leaf', color: '#e7eee5', minimumHours: null, comfortHours: null, maximumHours: null, protected: false, hidden: false, order: Math.max(-1, ...Store.state.lifeAreas.map(area => area.order)) + 1, description: '', systemType: null });
      const form = el('form');
      const description = el('textarea', { name: 'description', maxlength: 500 }, a.description);
      const counter = el('small', { class: 'counter', hidden: a.description.length < 400 }, `${a.description.length} / 500`);
      form.append(el('div', { class: 'form-grid' }, field('Название сферы', input('name', a.name, 'text', { required: true, maxlength: 60, autocomplete: 'off' })), field('Значок', select('icon', AreaIcons.key(a), Object.entries(RU.icons))), field('Цвет', input('color', a.color, 'color')), field('Минимум, ч / неделю', input('minimumHours', a.minimumHours, 'number', { min: 0, step: 'any' })), field('Комфорт, ч / неделю', input('comfortHours', a.comfortHours, 'number', { min: 0, step: 'any' })), field('Максимум, ч / неделю', input('maximumHours', a.maximumHours, 'number', { min: 0, step: 'any' })), el('div', { class: 'field full-width' }, field('Описание', description), counter), check('Защищать новые блоки этой сферы', 'protected', a.protected), check('Скрыть из активного списка', 'hidden', a.hidden)));
      form.append(el('p', { class: 'hint', style: 'margin-top:16px' }, 'Пустые нормативы не участвуют в проверках. Изменение защиты не меняет существующие блоки.'), el('p', { class: 'hint' }, 'Черновик сохраняется автоматически. Кнопка «Сохранить» применяет изменения.'));
      const error = el('p', { class: 'error', role: 'alert' }); form.append(error);
      const read = () => { const f = new FormData(form); return { ...a, name: String(f.get('name')), icon: f.get('icon'), color: f.get('color'), description: String(f.get('description')), minimumHours: Utils.number(f.get('minimumHours')), comfortHours: Utils.number(f.get('comfortHours')), maximumHours: Utils.number(f.get('maximumHours')), protected: f.has('protected'), hidden: f.has('hidden') }; };
      form.addEventListener('input', e => { const text = e.target.type === 'text' || e.target.tagName === 'TEXTAREA'; Store.change(s => { s.uiState.areaDraft = read(); }, text); counter.hidden = description.value.length < 400; counter.textContent = `${description.value.length} / 500`; });
      form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); try { AreaService.save(read()); UI.close(); UI.render(); UI.toast('Сфера сохранена'); } catch (err) { error.textContent = err.message; } });
      form.append(el('div', { class: 'form-footer' }, existing && !existing.systemType ? button('Удалить сферу', () => UI.deleteArea(existing), 'danger') : el('span', { class: 'hint' }, existing?.systemType ? 'Системную сферу нельзя удалить' : 'Новая сфера'), el('div', { class: 'actions' }, button('Отменить изменения', () => { Store.change(s => { delete s.uiState.areaDraft; }); UI.close(); UI.render(); }), el('button', { type: 'submit', class: 'button primary' }, 'Сохранить'))));
      UI.open(existing ? 'Изменить сферу' : 'Новая сфера', form);
    },
    deleteArea(area) {
      const count = AreaService.references(area.id); const form = el('form'); const fallback = Store.state.lifeAreas.find(a => a.systemType === 'uncategorized').id;
      form.append(el('p', { class: 'subtitle' }, `Сфера «${area.name}» будет удалена. Это действие нельзя отменить.`), el('p', { class: 'hint' }, count ? `Связанных задач, блоков и серий: ${count}. Выбери, куда перенести связи.` : 'Если есть связанные записи, они будут перенесены в выбранную сферу.'), field('Перенести связанные записи в', select('target', fallback, AreaService.ordered().filter(a => a.id !== area.id).map(a => [a.id, a.name]))));
      const error = el('p', { class: 'error', role: 'alert' }); form.append(error, el('div', { class: 'form-footer' }, button('Отмена', () => UI.areaEditor(area.id)), el('button', { type: 'submit', class: 'button danger' }, 'Удалить сферу')));
      form.addEventListener('submit', e => { e.preventDefault(); try { AreaService.remove(area.id, new FormData(form).get('target')); UI.close(); UI.render(); UI.toast('Сфера удалена. Связанные записи сохранены.'); } catch (err) { error.textContent = err.message; } }); UI.open('Удалить сферу?', form);
    },
    settings(main) {
      main.append(this.heading('Настройки', 'Твой привычный ритм — отправная точка. Его можно менять.', button('Пройти знакомство заново', () => Wizard.start(true))));
      const savedDraft = Store.state.uiState.settingsDraft;
      const draft = Utils.clone(savedDraft || { settings: Store.state.settings, name: Store.state.profile.name, effectiveFrom: Utils.monday() });
      const form = el('form', { class: 'panel', 'aria-label': 'Базовые настройки' });
      form.append(el('fieldset', { class: 'form-section' }, el('legend', {}, 'Личное пространство'), el('div', { class: 'form-grid' }, field('Как тебя зовут', input('profileName', draft.name, 'text', { maxlength: 60, autocomplete: 'given-name' })), field('Резерв бодрствования, %', input('weeklyBufferPercent', draft.settings.weeklyBufferPercent, 'number', { min: 0, max: 50, step: 1, required: true }), 'Ориентир для будущего бюджета недели'))));
      form.append(Forms.sleep(draft.settings), Forms.work(draft.settings), Forms.commute(draft.settings), Forms.focus(draft.settings));
      form.append(el('fieldset', { class: 'form-section' }, el('legend', {}, 'Календарь и дата действия'), el('div', { class: 'form-grid' }, field('Первый час календаря', input('calendarStartHour', draft.settings.calendarStartHour, 'number', { min: 0, max: 23, required: true })), field('Последний час календаря', input('calendarEndHour', draft.settings.calendarEndHour, 'number', { min: 1, max: 24, required: true })), field('Применить график с', Forms.effective(draft.effectiveFrom), 'Прошедшие недели не изменятся. Неделя начинается в понедельник.'))));
      const error = el('p', { class: 'error', role: 'alert' }); form.append(error, el('div', { class: 'form-footer' }, el('span', { class: 'hint' }, 'Черновик сохраняется автоматически'), el('div', { class: 'actions' }, button('Отменить изменения', () => { Store.change(s => { delete s.uiState.settingsDraft; }); UI.render(); }), el('button', { type: 'submit', class: 'button primary' }, 'Сохранить настройки'))));
      form.addEventListener('input', e => { const data = Forms.read(form, draft.settings); Store.change(s => { s.uiState.settingsDraft = { settings: data, name: form.elements.profileName.value, effectiveFrom: form.elements.effectiveFrom.value }; }, e.target.type === 'text'); });
      form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); try { SettingsService.apply(Forms.read(form, draft.settings), form.elements.profileName.value, form.elements.effectiveFrom.value); UI.render(); UI.toast('Настройки сохранены'); } catch (err) { error.textContent = err.message; error.scrollIntoView({ block: 'center' }); } });
      main.append(el('div', { class: 'settings-layout' }, form, el('aside', { class: 'settings-aside' }, el('section', { class: 'panel' }, el('h3', {}, 'Ритм, который подходит тебе'), el('p', {}, 'Сон, работа и дорога формируют резервы в календаре и учитываются в бюджете недели.'), el('p', {}, 'Изменения вступают в силу с выбранной недели. Прошлые недели сохраняют свой график.')), el('section', { class: 'panel' }, el('h3', {}, 'Хранится рядом'), el('p', {}, 'Данные остаются в этом браузере. Перенос файла или очистка данных браузера могут сделать локальную копию недоступной.'), el('p', {}, 'Сохрани резервную копию перед переносом данных в другой браузер.'), button('Скачать резервную копию', () => backup(), 'small')))));
      main.append(el('section', { class: 'panel' }, el('h2', {}, 'Локальные данные'), el('p', { class: 'hint' }, `Размер сохранения: ${(Store.bytes / 1024).toFixed(1)} КБ из мягкого лимита 3 МБ. История не удаляется автоматически.`), button('Скачать резервную копию', () => backup()), savedDraft ? el('p', { class: 'hint', style: 'margin-top:12px' }, 'Восстановлен незавершённый черновик настроек.') : null));
    },
    recovery(main) {
      main.append(el('section', { class: 'panel recovery' }, el('h1', {}, 'Сохраним твои данные'), el('p', { class: 'subtitle' }, Store.lastError), el('p', { class: 'hint' }, 'Приложение не перезаписывает сохранённое значение. Сначала скачай его копию. Затем можно попробовать открыть данные снова или начать заново.'), el('div', { class: 'actions' }, button('Скачать исходные данные', () => backup(true), 'primary', { disabled: Store.raw === null }), button('Повторить чтение', () => App.init()), button('Сбросить повреждённые данные', () => UI.resetDialog(), 'danger')))); UI.status();
    },
    resetDialog() {
      const form = el('form'); const error = el('p', { class: 'error', role: 'alert' });
      form.append(el('p', { class: 'subtitle' }, 'Данные этого приложения будут удалены. Сначала сохрани исходную копию.'), field('Введи УДАЛИТЬ для подтверждения', input('confirm', '', 'text', { required: true, autocomplete: 'off', pattern: 'УДАЛИТЬ' })), error, el('div', { class: 'form-footer' }, button('Отмена', () => UI.close()), el('button', { type: 'submit', class: 'button danger' }, 'Удалить данные')));
      form.addEventListener('submit', e => { e.preventDefault(); if (form.elements.confirm.value !== 'УДАЛИТЬ') return; try { Store.reset(); UI.close(); App.show(); } catch { error.textContent = 'Браузер не разрешает очистку. Исходные данные не изменены.'; } }); UI.open('Сбросить данные?', form);
    }
  };
  const Forms = {
    sleep(s) { return el('fieldset', { class: 'form-section' }, el('legend', {}, 'Сон'), el('div', { class: 'form-grid' }, field('Начало сна в будни', input('weekdayStart', s.sleep.weekdayStart, 'time', { required: true })), field('Пробуждение в будни', input('weekdayEnd', s.sleep.weekdayEnd, 'time', { required: true })), field('Начало сна в выходные', input('weekendStart', s.sleep.weekendStart, 'time', { required: true })), field('Пробуждение в выходные', input('weekendEnd', s.sleep.weekendEnd, 'time', { required: true }))), el('p', { class: 'hint', style: 'margin-top:12px' }, 'Если окончание раньше начала, сон продолжается на следующий день.')); },
    work(s) { return el('fieldset', { class: 'form-section' }, el('legend', {}, 'Рабочий ритм'), days('workDays', s.work.days), el('div', { class: 'form-grid', style: 'margin-top:16px' }, field('Начало рабочего дня', input('workStart', s.work.start, 'time', { required: true })), field('Конец рабочего дня', input('workEnd', s.work.end, 'time', { required: true }))), el('p', { class: 'hint', style: 'margin-top:12px' }, 'Рабочий резерв отражает всё обязательство. Перерыв не вычитается автоматически.')); },
    commute(s) {
      const details = el('div', { hidden: !s.commute.enabled, style: 'margin-top:16px' }, days('commuteDays', s.commute.days), el('div', { class: 'form-grid', style: 'margin-top:16px' }, field('Дорога на работу: начало', input('outStart', s.commute.outStart, 'time', { required: true })), field('Дорога на работу: конец', input('outEnd', s.commute.outEnd, 'time', { required: true })), field('Дорога с работы: начало', input('backStart', s.commute.backStart, 'time', { required: true })), field('Дорога с работы: конец', input('backEnd', s.commute.backEnd, 'time', { required: true }))));
      const update = enabled => { details.hidden = !enabled; details.querySelectorAll('input').forEach(n => { n.disabled = !enabled; }); }; update(s.commute.enabled);
      const toggle = check('Учитывать дорогу на работу', 'commuteEnabled', s.commute.enabled);
      toggle.querySelector('input').addEventListener('input', e => update(e.target.checked));
      return el('fieldset', { class: 'form-section' }, el('legend', {}, 'Рабочая дорога'), toggle, details);
    },
    focus(s) {
      const mode = select('focusMode', `${s.focus.workMinutes}/${s.focus.breakMinutes}`, [['25/5', 'Лёгкий старт · 25 / 5'], ['50/10', 'Фокус · 50 / 10'], ['75/15', 'Глубокая работа · 75 / 15'], ['30/5', 'Короткий рабочий цикл · 30 / 5'], ['custom', 'Свой интервал']]);
      if (!mode.value) mode.value = 'custom';
      const work = input('workMinutes', s.focus.workMinutes, 'number', { min: 1, max: 1440, required: true });
      const rest = input('breakMinutes', s.focus.breakMinutes, 'number', { min: 1, max: 1440, required: true });
      mode.addEventListener('change', () => { if (mode.value !== 'custom') { [work.value, rest.value] = mode.value.split('/'); work.dispatchEvent(new Event('input', { bubbles: true })); } });
      for (const n of [work, rest]) n.addEventListener('input', e => { if (e.isTrusted) mode.value = 'custom'; });
      return el('fieldset', { class: 'form-section' }, el('legend', {}, 'Таймер фокуса'), field('Режим по умолчанию', mode), el('div', { class: 'form-grid', style: 'margin-top:16px' }, field('Работа, минут', work), field('Перерыв, минут', rest), field('Длинный перерыв, минут', input('longBreakMinutes', s.focus.longBreakMinutes, 'number', { min: 1, max: 1440, required: true }), 'После четырёх рабочих циклов')));
    },
    effective(value) { return select('effectiveFrom', [Utils.monday(), Utils.monday(1)].includes(value) ? value : Utils.monday(), [[Utils.monday(), `С текущей недели · ${Utils.dateLabel(Utils.monday())}`], [Utils.monday(1), `Со следующей недели · ${Utils.dateLabel(Utils.monday(1))}`]]); },
    read(form, original) {
      const s = Utils.clone(original), f = new FormData(form); const has = name => Boolean(form.elements.namedItem(name));
      for (const k of ['weekdayStart', 'weekdayEnd', 'weekendStart', 'weekendEnd']) if (has(k)) s.sleep[k] = f.get(k);
      if (has('workDays')) s.work.days = f.getAll('workDays').map(Number);
      if (has('workStart')) s.work.start = f.get('workStart'); if (has('workEnd')) s.work.end = f.get('workEnd');
      if (has('commuteEnabled')) { s.commute.enabled = f.has('commuteEnabled'); if (s.commute.enabled) { s.commute.days = f.getAll('commuteDays').map(Number); for (const k of ['outStart', 'outEnd', 'backStart', 'backEnd']) s.commute[k] = f.get(k); } }
      for (const k of ['workMinutes', 'breakMinutes', 'longBreakMinutes']) if (has(k)) s.focus[k] = Number(f.get(k));
      for (const k of ['weeklyBufferPercent', 'calendarStartHour', 'calendarEndHour']) if (has(k)) s[k] = Number(f.get(k));
      return s;
    }
  };
  const Wizard = {
    titles: ['Добро пожаловать', 'Что важно для тебя', 'Время для сна', 'Твой рабочий ритм', 'Дорога на работу', 'Ориентиры для сфер', 'Защищённое время', 'Режим фокуса', 'Твоё пространство готово'],
    start(restart = false) {
      if (restart || !Store.state.uiState.onboardingDraft) Store.change(s => { s.uiState.onboardingDraft = { step: 0, settings: Utils.clone(s.settings), areas: Utils.clone(s.lifeAreas), effectiveFrom: Utils.monday() }; });
      this.render();
    },
    render() {
      const d = Store.state.uiState.onboardingDraft;
      if (!d || !Number.isInteger(d.step) || d.step < 0 || d.step >= this.titles.length || !Array.isArray(d.areas) || !d.settings) { Store.change(s => { delete s.uiState.onboardingDraft; }); return this.start(); }
      const step = d.step, form = el('form');
      form.append(el('p', { class: 'eyebrow' }, `ЗНАКОМСТВО С ПРИЛОЖЕНИЕМ · ${step + 1} ИЗ ${this.titles.length}`), el('div', { class: 'wizard-progress', 'aria-hidden': 'true' }, this.titles.map((_, i) => el('span', { class: i <= step ? 'current' : '' }))));
      if (step === 0) form.append(el('div', { class: 'wizard-intro' }, el('strong', {}, '168'), el('h3', {}, 'Часы, из которых складывается жизнь'), el('p', {}, 'В неделе 168 часов. Сначала распределим обязательное время, затем освободим пространство для того, что действительно важно.'), el('p', { class: 'hint' }, 'Без регистрации. Всё хранится в твоём браузере.')));
      if (step === 1 || step === 6) {
        form.append(el('p', { class: 'subtitle' }, step === 1 ? 'Начни с готового списка. Позже можно добавить свои сферы, изменить названия и порядок.' : 'Новые блоки выбранных сфер будут защищены. Уже созданные блоки сохранят свои настройки.'), el('div', { class: 'wizard-scroll wizard-choice' }, d.areas.filter(a => step === 1 ? !['uncategorized', 'commute'].includes(a.systemType) : !a.hidden).map(a => check(a.name, `area_${a.id}`, step === 1 ? !a.hidden : a.protected))));
      }
      if (step === 2) form.append(Forms.sleep(d.settings));
      if (step === 3) form.append(Forms.work(d.settings));
      if (step === 4) form.append(Forms.commute(d.settings));
      if (step === 5) form.append(el('p', { class: 'hint' }, 'Часы в неделю. Все поля необязательны: ориентиры можно задать позже.'), UI.normTotals(d.areas), el('div', { class: 'wizard-scroll' }, d.areas.filter(a => !a.hidden).map(a => el('div', { class: 'norm-row' }, el('span', {}, a.name), ['minimumHours', 'comfortHours', 'maximumHours'].map((key, i) => field(['Минимум', 'Комфорт', 'Максимум'][i], input(`${key}_${a.id}`, a[key], 'number', { min: 0, step: 'any', 'aria-label': `${a.name}: ${['минимум', 'комфорт', 'максимум'][i]}` })))))));
      if (step === 7) form.append(Forms.focus(d.settings));
      if (step === 8) {
        const sleep = Utils.duration(d.settings.sleep.weekdayStart, d.settings.sleep.weekdayEnd) * 5 + Utils.duration(d.settings.sleep.weekendStart, d.settings.sleep.weekendEnd) * 2;
        const work = Utils.duration(d.settings.work.start, d.settings.work.end) * d.settings.work.days.length;
        const commute = d.settings.commute.enabled ? (Utils.duration(d.settings.commute.outStart, d.settings.commute.outEnd) + Utils.duration(d.settings.commute.backStart, d.settings.commute.backEnd)) * d.settings.commute.days.length : 0;
        form.append(el('div', { class: 'stat-grid' }, UI.stat('Сон', Utils.formatMinutes(sleep), 'в неделю'), UI.stat('Рабочий график', Utils.formatMinutes(work), 'в неделю'), UI.stat('Рабочая дорога', Utils.formatMinutes(commute), 'в неделю')),
          el('p', { class: 'subtitle', style: 'margin-top:20px' }, `Выбрано сфер: ${d.areas.filter(a => !a.hidden).length}. Сумма обязательств: ${Utils.formatMinutes(sleep + work + commute)}. Остаток до учёта пересечений: ${Utils.formatMinutes(Math.max(0, 10080 - sleep - work - commute))}.`),
          el('p', { class: 'hint' }, 'Это сводка длительностей графика. После сохранения открой «Бюджет 168»: там учитываются пересечения и календарные блоки выбранной недели.'), field('Применить график с', Forms.effective(d.effectiveFrom), 'Завершённые недели не изменятся.'));
      }
      const error = el('p', { class: 'error', role: 'alert' }); form.append(error);
      const capture = () => {
        const settings = Forms.read(form, d.settings), areas = Utils.clone(d.areas), f = new FormData(form);
        if (step === 1) areas.forEach(a => { if (form.elements.namedItem(`area_${a.id}`)) a.hidden = !f.has(`area_${a.id}`); });
        if (step === 6) areas.forEach(a => { if (form.elements.namedItem(`area_${a.id}`)) a.protected = f.has(`area_${a.id}`); });
        if (step === 5) areas.filter(a => !a.hidden).forEach(a => ['minimumHours', 'comfortHours', 'maximumHours'].forEach(k => { a[k] = Utils.number(f.get(`${k}_${a.id}`)); }));
        return { ...d, settings, areas, effectiveFrom: step === 8 ? f.get('effectiveFrom') : d.effectiveFrom };
      };
      form.addEventListener('input', () => {
        const next = capture(); Store.change(s => { s.uiState.onboardingDraft = next; });
        if (step === 5) form.querySelector('.norm-totals').replaceWith(UI.normTotals(next.areas));
      });
      form.addEventListener('submit', e => {
        e.preventDefault(); try {
          const next = capture(); Validation.settings(next.settings); next.areas.forEach(a => Validation.area(a));
          if (step === 8) { SettingsService.apply(next.settings, Store.state.profile.name, next.effectiveFrom); Store.change(s => { s.lifeAreas = next.areas; s.uiState.onboardingComplete = true; s.uiState.activeSection = 'week'; delete s.uiState.onboardingDraft; }); UI.close(); UI.render(); UI.toast('Настройка сохранена'); }
          else { next.step++; Store.change(s => { s.uiState.onboardingDraft = next; }); Wizard.render(); }
        } catch (err) { error.textContent = err.message; }
      });
      form.append(el('div', { class: 'form-footer' }, step ? button('Назад', () => { const previous = capture(); previous.step--; Store.change(s => { s.uiState.onboardingDraft = previous; }); Wizard.render(); }) : button('Пропустить', () => Wizard.skip()), el('div', { class: 'actions' }, step ? button('Настроить позже', () => Wizard.skip(), 'subtle') : null, el('button', { type: 'submit', class: 'button primary' }, step === 8 ? 'Открыть мою неделю' : step === 0 ? 'Начать настройку →' : 'Далее →'))));
      UI.open(this.titles[step], form);
    },
    skip() { Store.change(s => { s.uiState.onboardingComplete = true; delete s.uiState.onboardingDraft; }); UI.close(); UI.render(); UI.toast('Можно вернуться к настройке в любой момент'); }
  };
  const CalendarUI = {
    date() { const value = Store.state.uiState.selectedDate || Utils.localDate(); try { DateUtils.minute(`${value}T00:00`); return value; } catch { return Utils.localDate(); } },
    choose(date) { try { DateUtils.minute(`${date}T00:00`); Store.change(s => { s.uiState.selectedDate = date; s.uiState.selectedWeek = DateUtils.weekId(date); s.uiState.fullCalendar = false; }); UI.render(); } catch (e) { UI.toast(e.message); } },
    area(id) { return Store.state.lifeAreas.find(a => a.id === id) || Store.state.lifeAreas.find(a => a.systemType === 'uncategorized'); },
    toolbar(date) {
      const picker = input('selectedDate', date, 'date', { required: true, 'aria-label': 'Выбрать дату и неделю' });
      picker.addEventListener('change', () => { if (picker.value) this.choose(picker.value); });
      return el('div', { class: 'calendar-toolbar' }, el('div', { class: 'actions' }, button('←', () => this.choose(DateUtils.add(date, -7)), 'small', { 'aria-label': 'Предыдущая неделя' }), button('Текущая неделя', () => this.choose(Utils.localDate()), 'small'), button('→', () => this.choose(DateUtils.add(date, 7)), 'small', { 'aria-label': 'Следующая неделя' })), field('Дата / неделя', picker));
    },
    render(main, section) {
      const date = this.date(), week = DateUtils.weekStart(date), last = DateUtils.add(week, 6), data = CalendarService.openWeek(date);
      main.append(UI.heading(section === 'week' ? 'Моя неделя' : '168 часов', `${Utils.dateLabel(week)} — ${Utils.dateLabel(last)} · ${DateUtils.weekId(week)}`, button('+ Добавить блок', () => this.editor(null, { startDateTime: `${date}T09:00`, endDateTime: `${date}T10:00` }), 'primary')));
      main.append(this.toolbar(date));
      if (section === 'week') FocusUI.today(main);
      if (Store.state.uiState.blockDraft) main.append(el('div', { class: 'panel' }, el('p', { class: 'hint' }, 'Есть сохранённый черновик календарного блока.'), button('Продолжить блок', () => { const d = Store.state.uiState.blockDraft; this.editor(d.old, d.block, d); }, 'small')));
      main.append(el('section', { class: `week-summary ${data.overload > 300 ? 'critical' : ''}`, 'aria-label': 'Состояние недели' }, el('div', {}, el('span', { class: 'eyebrow' }, 'ЗАГРУЗКА НЕДЕЛИ'), el('h2', {}, data.status)), el('div', { class: 'summary-stat' }, el('span', {}, 'Физически занято'), el('strong', { 'data-metric': 'physical' }, Utils.formatMinutes(data.physical))), el('div', { class: 'summary-stat' }, el('span', {}, 'Не распределено'), el('strong', { 'data-metric': 'remaining' }, Utils.formatMinutes(data.remaining))), el('div', { class: 'summary-stat' }, el('span', {}, 'Конфликтное время'), el('strong', { 'data-metric': 'conflict' }, Utils.formatMinutes(data.conflict)))));
      if (data.overload) main.append(el('p', { class: 'calendar-warning', role: 'status' }, `Суммарные обязательства требуют ${Utils.formatMinutes(data.demand)}. Избыточный спрос — ${Utils.formatMinutes(data.overload)}. План можно сохранить и затем скорректировать.`));
      if (section === 'budget') this.budget(main, data, week); else this.calendar(main, data, date);
      if (section === 'week' && date !== Utils.localDate()) WorkUI.dailyFacts(main, date);
      this.protectedTime(main, week);
    },
    budget(main, data, week) {
      const fact = WorkUI.factBudget(main, week);
      const cards = [['Общая ёмкость', 10080], ['Плановый сон', data.sleep], ['Ёмкость бодрствования', data.waking], ['Обязательства требуют', data.demand], ['Избыточный спрос', data.overload], ['Работа без повторного учёта', data.work], ['Свободный резерв бодрствования', data.free], ['Цель резерва', data.target]];
      main.append(el('div', { class: 'budget-grid' }, cards.map(([name, value]) => UI.stat(name, Utils.formatMinutes(value), name === 'Цель резерва' ? 'Доля от времени бодрствования' : 'За выбранную неделю'))));
      main.append(el('section', { class: 'panel', style: 'margin-top:20px' }, el('h2', {}, 'Каждая минута — один раз'), el('p', { class: 'subtitle' }, 'Физически занятое время объединяет пересечения. Спрос сохраняет независимые обязательства. Рабочий блок внутри рабочего графика уточняет его содержание и не прибавляет часы повторно.'), el('p', { class: 'hint' }, 'Один совместный блок может поддерживать несколько сфер. Их вклады не складываются в общий физический бюджет.'), button('Распределить время в календаре', () => UI.navigate('week'))));
      const table = el('table', { class: 'budget-table' }, el('caption', {}, 'Календарный вклад в сферы'), el('thead', {}, el('tr', {}, ['Сфера', 'Вклад, план', 'Вклад, факт', 'Минимум', 'Комфорт', 'Максимум'].map(x => el('th', { scope: 'col' }, x)))));
      table.append(el('tbody', {}, AreaService.ordered().filter(a => !a.hidden || data.contributions[a.id]).map(a => el('tr', {}, el('th', { scope: 'row' }, a.name), el('td', {}, Utils.formatMinutes(data.contributions[a.id] || 0)), el('td', {}, WorkUI.factText(a.systemType === 'work' ? fact.work : fact.contributions[a.id]), fact.counts[a.id]?.known < fact.counts[a.id]?.total ? ' · частично' : ''), ...['minimumHours', 'comfortHours', 'maximumHours'].map(k => el('td', {}, a[k] === null ? '—' : `${a[k]} ч`))))));
      main.append(el('div', { class: 'table-scroll panel' }, table));
    },
    calendar(main, data, date) {
      main.append(WorkUI.filters('blocks', () => UI.render()));
      const week = DateUtils.weekStart(date), allBlocks = RecurrenceService.blocks(Store.state, week, DateUtils.add(week, 6)).filter(b => SearchService.matches(b, 'blocks', Store.state.uiState.blocksFilters));
      const full = Store.state.uiState.fullCalendar, fromHour = full ? 0 : Store.state.settings.calendarStartHour, toHour = full ? 24 : Store.state.settings.calendarEndHour;
      const hasOutside = [...allBlocks, ...data.reserves].some(b => {
        for (let i = 0; i < 7; i++) { const start = DateUtils.minute(`${DateUtils.add(week, i)}T00:00`); const part = Intervals.clip(Intervals.of(b), start, start + 1440); if (part && (part[0] < start + fromHour * 60 || part[1] > start + toHour * 60)) return true; } return false;
      });
      if (hasOutside || full) main.append(button(full ? 'Вернуть настроенный диапазон' : 'Есть события вне видимого времени · Показать 00:00–24:00', () => { Store.change(s => { s.uiState.fullCalendar = !full; }); UI.render(); }, 'calendar-range'));
      const dayNav = el('div', { class: 'mobile-days', 'aria-label': 'День недели' }, Array.from({ length: 7 }, (_, i) => { const day = DateUtils.add(week, i); return button(`${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i]} ${day.slice(8)}`, () => this.choose(day), day === date ? 'primary small' : 'small', { 'aria-pressed': day === date }); })); main.append(dayNav);
      const grid = el('div', { class: 'calendar-grid', style: `--calendar-height:${(toHour - fromHour) * 60}px` });
      const scale = el('div', { class: 'time-scale' }, el('div', { class: 'day-heading' }, 'Время'), el('div', { class: 'time-body' }, Array.from({ length: toHour - fromHour + 1 }, (_, i) => el('span', { style: `top:${i * 60}px` }, `${String(fromHour + i).padStart(2, '0')}:00`)))); grid.append(scale);
      for (let i = 0; i < 7; i++) {
        const day = DateUtils.add(week, i), dayStart = DateUtils.minute(`${day}T00:00`), lo = dayStart + fromHour * 60, hi = dayStart + toHour * 60;
        const column = el('section', { class: `calendar-day ${day === date ? 'selected-day' : ''} ${day === Utils.localDate() ? 'today-column' : ''}`, 'aria-label': Utils.dateLabel(day) });
        column.append(el('div', { class: 'day-heading' }, el('span', {}, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i], el('strong', {}, day.slice(8))), button('+', () => this.editor(null, { startDateTime: `${day}T09:00`, endDateTime: `${day}T10:00` }), 'small', { 'aria-label': `Добавить блок ${Utils.dateLabel(day)}` })));
        const body = el('div', { class: 'day-body' });
        for (let h = fromHour; h < toHour; h++) body.append(button('', () => this.editor(null, { startDateTime: `${day}T${String(h).padStart(2, '0')}:00`, endDateTime: DateUtils.stamp(dayStart + (h + 1) * 60) }), 'hour-slot', { style: `top:${(h - fromHour) * 60}px`, 'aria-label': `Добавить блок ${Utils.dateLabel(day)} в ${h}:00` }));
        for (const r of data.reserves) {
          const part = Intervals.clip(Intervals.of(r), lo, hi); if (!part) continue;
          body.append(button([r.type === 'sleep' ? 'Сон' : r.type === 'work' ? 'Работа · график' : 'Рабочая дорога'].join(''), () => this.reservation(r, day), `calendar-reservation reserve-${r.type}`, { style: `top:${part[0] - lo}px;height:${Math.max(18, part[1] - part[0])}px`, 'aria-label': `${r.type === 'sleep' ? 'Сон' : r.type === 'work' ? 'Рабочий график' : 'Дорога'} ${r.startDateTime.slice(11)}–${r.endDateTime.slice(11)}` }));
        }
        const events = allBlocks.map(b => ({ b, span: Intervals.clip(Intervals.of(b), lo, hi) })).filter(x => x.span).sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]);
        // Линии пересекающихся событий распределяются по независимым дорожкам.
        let group = [], end = -Infinity;
        const draw = () => {
          const lanes = []; for (const item of group) { let lane = lanes.findIndex(last => last <= item.span[0]); if (lane < 0) lane = lanes.length; lanes[lane] = item.span[1]; item.lane = lane; }
          for (const { b, span, lane } of group) {
            const area = this.area(b.primaryAreaId), conflicted = activeBlock(b) && data.conflictSpans.some(c => Intervals.clip(c, ...span));
            body.append(el('button', { type: 'button', class: `calendar-event ${!activeBlock(b) ? 'inactive-event' : ''} ${conflicted ? 'conflict-event' : ''}`, style: `top:${span[0] - lo}px;height:${Math.max(26, span[1] - span[0])}px;left:calc(${lane / lanes.length * 100}% + 3px);width:calc(${100 / lanes.length}% - 6px);background:${area.color}`, 'aria-label': `${b.title}, ${b.startDateTime.slice(11)}–${b.endDateTime.slice(11)}, ${BLOCK_STATUSES[b.status]}${b.protected ? ', защищённый блок' : ''}`, onclick: () => this.details(b) }, el('strong', {}, `${b.protected ? '◇ ' : ''}${b.title}`), el('span', {}, `${b.startDateTime.slice(11)}–${b.endDateTime.slice(11)}${b.seriesId ? ' ↻' : ''}`), el('small', {}, `${area.name}${conflicted ? ' · конфликт' : ''}${!activeBlock(b) ? ` · ${BLOCK_STATUSES[b.status]}` : ''}`)));
          }
        };
        for (const item of events) { if (item.span[0] >= end) { draw(); group = []; end = -Infinity; } group.push(item); end = Math.max(end, item.span[1]); } draw();
        column.append(body); grid.append(column);
      }
      main.append(el('div', { class: 'calendar-scroll' }, grid));
      main.append(el('p', { class: 'hint', style: 'margin-top:12px' }, 'Кликни по времени или «+», чтобы добавить блок. Перенос и изменение длительности — в карточке блока. ◇ — защищённое время, ↻ — повторение.'));
      if (!allBlocks.length) main.append(el('div', { class: 'panel empty' }, el('h2', {}, 'На этой неделе пока нет твоих блоков'), el('p', { class: 'subtitle' }, 'Сон, работа и дорога уже показаны как системные резервы. Добавь время для важной сферы.'), button('+ Добавить блок', () => this.editor(), 'primary')));
      const dayStart = DateUtils.minute(`${date}T00:00`), daily = BudgetService.calculate(Store.state, date, [dayStart, dayStart + 1440]);
      if (daily.nonSleep > 960 || daily.conflict) main.append(el('p', { class: 'calendar-warning' }, `${Utils.dateLabel(date)}: нагрузка вне сна — ${Utils.formatMinutes(daily.nonSleep)}; конфликтное время — ${Utils.formatMinutes(daily.conflict)}.`));
    },
    reservation(r, day) {
      const names = { sleep: 'Сон', work: 'Рабочий график', commute: 'Рабочая дорога' };
      UI.open(names[r.type], el('div', {}, el('p', { class: 'subtitle' }, `${Utils.dateLabel(r.startDateTime.slice(0, 10))} ${r.startDateTime.slice(11)} — ${Utils.dateLabel(r.endDateTime.slice(0, 10))} ${r.endDateTime.slice(11)}`), el('p', { class: 'hint' }, 'Это системный резерв из настроек. Изменения графика применяются с выбранной недели.'), el('div', { class: 'actions' }, button('Изменить график', () => { UI.close(); UI.navigate('settings'); }), button('Добавить блок в это время', () => this.editor(null, { startDateTime: `${day}T${r.startDateTime.slice(11)}`, endDateTime: DateUtils.stamp(DateUtils.minute(`${day}T${r.startDateTime.slice(11)}`) + 60), primaryAreaId: r.primaryAreaId || this.area(null).id }), 'primary'))));
      if (r.type !== 'sleep') document.querySelector('dialog .actions').append(button('Подтвердить факт', () => WorkUI.reservationFact(r)));
    },
    details(b) {
      const info = el('div', {}, el('p', { class: 'subtitle' }, `${Utils.dateLabel(b.startDateTime.slice(0, 10))} ${b.startDateTime.slice(11)} → ${Utils.dateLabel(b.endDateTime.slice(0, 10))} ${b.endDateTime.slice(11)}`), el('p', {}, `${this.area(b.primaryAreaId).name} · ${Utils.formatMinutes(b.plannedMinutes)} · ${BLOCK_STATUSES[b.status]}`), el('p', { class: 'hint' }, `${b.protected ? '◇ Защищённый блок. ' : ''}${b.seriesId ? 'Повторяющееся событие. ' : ''}${ENERGY_NAMES[b.energyRequired]}`));
      if (b.additionalAreaIds?.length) info.append(el('p', { class: 'hint' }, `Также поддерживает: ${b.additionalAreaIds.map(id => this.area(id).name).join(', ')}`));
      if (b.note) info.append(el('p', { class: 'block-note' }, b.note));
      info.append(button('Запустить таймер для блока', () => FocusUI.open(null, b), 'primary small'));
      info.append(el('p', {}, `План: ${Utils.formatMinutes(b.plannedMinutes)} · Факт: ${WorkUI.factText(b.actualMinutes)}`), el('div', { class: 'actions' }, button('Выполнено по плану', () => this.submit({ old: b, block: { ...b, status: 'completed', actualMinutes: b.plannedMinutes } }, () => this.details(b))), button('Внести факт', () => WorkUI.blockFact(b))));
      for (const id of b.taskIds || []) { const task = Store.state.tasks.find(t => t.id === id); if (task) info.append(button(`Задача: ${task.title}`, () => WorkUI.taskDetails(task), 'small')); }
      info.append(el('div', { class: 'actions' }, button('Изменить время / перенести', () => this.editor(b), 'primary'), button('Редактировать блок', () => this.editor(b)), button('Копировать', () => { const copy = { ...b, id: undefined, seriesId: undefined, occurrenceDate: undefined, virtual: undefined, sourceInboxId: undefined, actualMinutes: null, status: 'planned' }; this.editor(null, copy); })));
      info.append(el('div', { class: 'block-status-actions' }, Object.entries(BLOCK_STATUSES).filter(([key]) => key !== b.status).map(([key, name]) => button(key === 'completed' ? 'Завершить' : key === 'partial' ? 'Отметить частично' : key === 'skipped' ? 'Пропустить' : key === 'cancelled' ? 'Отменить блок' : 'Запланировать снова', () => this.submit({ old: b, block: { ...b, status: key } }, () => this.details(b)), 'small'))));
      info.append(el('div', { class: 'form-footer' }, button('Закрыть', () => UI.close()), button('Удалить блок', () => this.deletion(b), 'danger'))); UI.open(b.title, info);
    },
    editor(old = null, preset = {}, saved = {}) {
      const date = this.date(), area = this.area(preset.primaryAreaId || old?.primaryAreaId);
      const b = { title: '', startDateTime: `${date}T09:00`, endDateTime: `${date}T10:00`, primaryAreaId: area.id, additionalAreaIds: [], protected: area.protected, status: 'planned', note: '', energyRequired: 'medium', actualMinutes: null, taskIds: [], ...Utils.clone(old || {}), ...preset };
      const existingRule = old?.seriesId && Store.state.recurrenceSeries.find(r => r.seriesId === old.seriesId);
      const form = el('form', { 'aria-label': old ? 'Изменение блока' : 'Новый блок' });
      const primary = select('primaryAreaId', b.primaryAreaId, AreaService.ordered().filter(a => !a.hidden || a.id === b.primaryAreaId || a.systemType).map(a => [a.id, a.name]));
      const protection = check('Защищённый блок', 'protected', b.protected);
      primary.addEventListener('change', () => { if (!old) protection.querySelector('input').checked = this.area(primary.value).protected; });
      const extra = el('details', { class: 'additional-areas' }, el('summary', {}, 'Дополнительные сферы · совместное занятие'), el('div', { class: 'wizard-choice' }, AreaService.ordered().filter(a => !a.hidden || b.additionalAreaIds.includes(a.id)).map(a => check(a.name, `additional_${a.id}`, b.additionalAreaIds.includes(a.id)))));
      const note = el('textarea', { name: 'note', maxlength: 2000 }, b.note), counter = el('small', { class: 'counter', hidden: b.note.length < 1600 }, `${b.note.length} / 2000`);
      note.addEventListener('input', () => { counter.hidden = note.value.length < 1600; counter.textContent = `${note.value.length} / 2000`; });
      form.append(el('div', { class: 'form-grid' }, field('Название блока', input('title', b.title, 'text', { maxlength: 120, required: true })), field('Главная сфера', primary), field('Дата и время начала', input('startDateTime', b.startDateTime, 'datetime-local', { required: true })), field('Дата и время окончания', input('endDateTime', b.endDateTime, 'datetime-local', { required: true })), field('Статус', select('status', b.status, Object.entries(BLOCK_STATUSES))), field('Требуемая энергия', select('energyRequired', b.energyRequired, Object.entries(ENERGY_NAMES))), protection, check('Рабочая дорога', 'commuteType', b.commuteType === 'work')), extra, field('Заметка', note), counter);
      const recurrence = select('frequency', saved.recurrence?.frequency || existingRule?.frequency || 'none', [['none', 'Не повторять'], ['daily', 'Ежедневно'], ['weekly', 'Еженедельно'], ['custom', 'По выбранным дням недели']]);
      let weekday = DateUtils.weekday(date); try { weekday = DateUtils.weekday(b.startDateTime.slice(0, 10)); } catch { /* Неполный черновик даты ещё редактируется. */ }
      const recurrenceDays = days('repeatDays', saved.recurrence?.weekdays || existingRule?.weekdays || [weekday]);
      const until = input('until', saved.recurrence?.until || existingRule?.until || '', 'date');
      const repeating = el('div', { class: 'recurrence-options' }, recurrenceDays, field('Повторять до (необязательно)', until));
      const displayRepeats = () => { repeating.hidden = recurrence.value === 'none'; recurrenceDays.hidden = recurrence.value !== 'custom'; }; recurrence.addEventListener('change', displayRepeats); displayRepeats();
      form.append(el('div', { class: 'form-grid', style: 'margin-top:18px' }, field('Повторение', recurrence), old?.seriesId ? field('Применить изменения', select('scope', saved.scope || 'one', [['one', 'Только это событие'], ['future', 'Это и будущие'], ['all', 'Всю серию']])) : null), repeating);
      const cause = check('Изменение связано с рабочим обязательством', 'dueToWork', saved.dueToWork || false);
      if (old?.protected) form.append(el('div', { class: 'panel protection-cause' }, cause, field('Причина изменения (необязательно)', input('reason', saved.reason || '', 'text', { maxlength: 500 })), el('p', { class: 'hint' }, 'Отметь, если работа заставляет сократить или убрать личное время. Перенос без потери длительности в той же неделе не считается вытеснением.')));
      const error = el('p', { class: 'error', role: 'alert' }); form.append(error);
      const read = () => {
        const f = new FormData(form);
        const next = { ...b, title: f.get('title').trim(), startDateTime: f.get('startDateTime'), endDateTime: f.get('endDateTime'), primaryAreaId: f.get('primaryAreaId'), additionalAreaIds: Store.state.lifeAreas.filter(a => f.has(`additional_${a.id}`)).map(a => a.id), protected: f.has('protected'), status: f.get('status'), energyRequired: f.get('energyRequired'), note: f.get('note'), commuteType: f.has('commuteType') ? 'work' : null };
        const rule = f.get('frequency') === 'none' ? null : { frequency: f.get('frequency'), weekdays: f.getAll('repeatDays').map(Number), until: f.get('until') || null };
        return { old, block: next, recurrence: rule, scope: f.get('scope') || 'one', dueToWork: f.has('dueToWork'), reason: f.get('reason') || '' };
      };
      form.addEventListener('input', e => { Store.change(s => { s.uiState.blockDraft = read(); }, e.target.type === 'text' || e.target.tagName === 'TEXTAREA'); });
      form.addEventListener('change', () => { Store.change(s => { s.uiState.blockDraft = read(); }); });
      form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); const operation = read(); this.submit(operation, () => this.editor(old, operation.block, operation), error); });
      form.append(el('p', { class: 'hint' }, 'Черновик сохраняется автоматически. «Сохранить блок» применяет изменения к календарю.'), el('div', { class: 'form-footer' }, button('Отмена', () => { Store.change(s => { delete s.uiState.blockDraft; }); old ? this.details(old) : UI.close(); }), el('button', { type: 'submit', class: 'button primary' }, 'Сохранить блок'))); UI.open(old ? 'Изменить блок' : 'Новый блок', form);
    },
    deletion(b) {
      const form = el('form'); form.append(el('p', { class: 'subtitle' }, `Удалить «${b.title}»?`));
      if (b.seriesId) form.append(field('Что удалить', select('scope', 'one', [['one', 'Только это событие'], ['future', 'Это и будущие'], ['all', 'Всю серию']])));
      if (b.protected) form.append(check('Это время займёт работа', 'dueToWork', false), field('Причина (необязательно)', input('reason', '', 'text', { maxlength: 500 })));
      const error = el('p', { class: 'error', role: 'alert' });
      form.append(error, el('div', { class: 'form-footer' }, button('Отмена', () => this.details(b)), el('button', { type: 'submit', class: 'button danger' }, 'Продолжить удаление')));
      form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form); this.submit({ old: b, remove: true, scope: f.get('scope') || 'one', dueToWork: f.has('dueToWork'), reason: f.get('reason') || '' }, () => this.deletion(b), error); }); UI.open('Удаление блока', form);
    },
    submit(operation, cancel, error) {
      try {
        const prepared = CalendarService.prepare(operation);
        const commit = () => { try { CalendarService.commit(prepared); UI.close(); UI.render(); UI.toast(operation.remove ? 'Блок удалён' : 'Изменения календаря сохранены'); } catch (e) { UI.toast(e.message); } };
        if (!prepared.notices.length) { commit(); return; }
        UI.open('Подтвердить изменение', el('div', {}, el('ul', { class: 'confirmation-list' }, prepared.notices.map(text => el('li', {}, text))), el('div', { class: 'form-footer' }, button('Отмена', cancel), button(operation.remove ? operation.scope === 'all' ? 'Удалить всю серию' : 'Подтвердить удаление' : 'Сохранить с подтверждением', commit, operation.remove ? 'danger' : 'primary'))));
      } catch (e) { if (error) error.textContent = e.message; else UI.toast(e.message); }
    },
    protectedTime(main, week) {
      const entries = ProtectionService.entries(Store.state, week), workId = Store.state.lifeAreas.find(a => a.systemType === 'work').id;
      const lost = entries.filter(e => e.targetAreaId === workId).reduce((n, e) => n + Math.max(0, e.minutes - (e.resolvedMinutes || 0)), 0);
      const blocks = RecurrenceService.blocks(Store.state, week, DateUtils.add(week, 6)).filter(b => b.protected && activeBlock(b) && b.primaryAreaId !== workId);
      const preserved = blocks.reduce((n, b) => n + Intervals.length([Intervals.clip(Intervals.of(b), ...DateUtils.bounds(week))]), 0), baseline = preserved + lost;
      const panel = el('section', { class: 'panel protected-panel' }, el('div', { class: 'section-head' }, el('h2', {}, 'Защищённое время'), el('span', { class: 'pill' }, `${blocks.length} блоков`)), el('p', { class: 'subtitle' }, `Индекс поглощения личного времени: ${Utils.formatMinutes(lost)}${baseline ? ` · ${Math.round(lost / baseline * 100)}%` : ' · нет данных для доли'}.`));
      if (lost >= 180) panel.append(el('p', { class: 'calendar-warning' }, 'Работа вытеснила три часа или больше защищённого личного времени.'));
      if (!entries.length) panel.append(el('p', { class: 'hint' }, 'Подтверждённые изменения защищённого времени появятся здесь. Перенос внутри недели без сокращения не создаёт вытеснение.'));
      for (const entry of entries) panel.append(el('div', { class: 'displacement-row' }, el('div', {}, el('strong', {}, this.area(entry.sourceAreaId).name), el('p', { class: 'hint' }, `${Utils.dateLabel(entry.date)} · ${entry.targetAreaId === workId ? 'Заменено работой' : 'Освобождено без рабочего замещения'}: ${Utils.formatMinutes(entry.minutes)}. Восстановлено: ${Utils.formatMinutes(entry.resolvedMinutes || 0)}.`), entry.reason ? el('p', { class: 'hint' }, entry.reason) : null), entry.targetAreaId === workId ? button('Учесть восстановление', () => this.compensation(entry), 'small') : null));
      main.append(panel);
    },
    compensation(entry) {
      const form = el('form'), error = el('p', { class: 'error', role: 'alert' });
      const week = DateUtils.weekStart(entry.date), choices = RecurrenceService.blocks(Store.state, week, DateUtils.add(week, 6)).filter(b => b.protected && activeBlock(b) && b.primaryAreaId === entry.sourceAreaId && b.id !== entry.sourceBlockId).map(b => [b.id, `${b.title} · ${Utils.dateLabel(b.startDateTime.slice(0, 10))} ${b.startDateTime.slice(11)}`]);
      form.append(el('p', { class: 'subtitle' }, `Сначала добавь новое защищённое время для сферы «${this.area(entry.sourceAreaId).name}» в эту же неделю. Затем выбери блок и укажи восстановленные минуты.`), field('Блок для восстановления', select('restorationBlock', entry.restorations?.[entry.date]?.blockId || choices[0]?.[0] || '', [['', 'Выбери защищённый блок'], ...choices])), field('Восстановлено минут', input('minutes', entry.resolvedMinutes || 0, 'number', { min: 0, max: entry.minutes, step: 1, required: true })), error, el('div', { class: 'form-footer' }, button('Отмена', () => UI.close()), el('button', { type: 'submit', class: 'button primary' }, 'Сохранить восстановление')));
      form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form); UI.confirmHistory(entry.date, () => { try { ProtectionService.resolve(entry.id, entry.date, Number(f.get('minutes')), f.get('restorationBlock')); UI.close(); UI.render(); UI.toast('Восстановленное время учтено'); } catch (e) { error.textContent = e.message; UI.toast(e.message); } }, () => this.compensation(entry)); }); UI.open('Восстановление личного времени', form);
    }
  };
  const WorkUI = {
    factText(value) { return value == null ? 'нет данных' : Utils.formatMinutes(value); },
    textarea(name, value, max) { const node = el('textarea', { name, maxlength: max }, value || ''), count = el('small', { class: 'counter', hidden: (value || '').length < max * .8 }, `${(value || '').length} / ${max}`); node.addEventListener('input', () => { count.hidden = node.value.length < max * .8; count.textContent = `${node.value.length} / ${max}`; }); return el('div', {}, node, count); },
    filters(kind, apply) {
      const saved = Store.state.uiState[`${kind}Filters`] || {}, form = el('form', { class: 'work-filters', 'aria-label': `Фильтры ${kind === 'tasks' ? 'задач' : kind === 'blocks' ? 'блоков' : 'входящих'}` });
      form.append(field('Поиск по тексту и заметкам', input('query', saved.query || '', 'search')));
      if (kind !== 'inbox') form.append(field('Сфера', select('area', saved.area || '', [['', 'Все сферы'], ...AreaService.ordered().map(a => [a.id, a.name])])), field('Статус', select('status', saved.status || '', [['', 'Все статусы'], ...Object.entries(kind === 'tasks' ? TASK_STATUSES : BLOCK_STATUSES)])), field('Энергия', select('energy', saved.energy || '', [['', 'Любая энергия'], ...Object.entries(ENERGY_NAMES)])), field('Выполнение', select('done', saved.done || '', [['', 'Все'], ['yes', 'Выполнено'], ['no', 'Не выполнено']])));
      else form.append(field('Категория', select('category', saved.category || '', [['', 'Все категории'], ...Object.entries(INBOX_CATEGORIES)])), field('Разбор', select('archive', saved.archive || '', [['', 'Неразобранные'], ['yes', 'Архив · разобранные'], ['all', 'Все записи']])));
      form.append(field(kind === 'tasks' ? 'Дедлайн' : kind === 'inbox' ? 'Дата добавления' : 'Дата блока', input('date', saved.date || '', 'date')));
      if (kind === 'tasks') form.append(field('Порядок', select('sort', saved.sort || 'created', [['created', 'Сначала новые'], ['leverage', 'По рычагу: 5 → 1']])));
      form.append(el('button', { class: 'button small', type: 'submit' }, 'Применить фильтры'), button('Сбросить фильтры', () => { Store.change(s => { delete s.uiState[`${kind}Filters`]; }); apply(); }, 'small'));
      form.addEventListener('submit', e => { e.preventDefault(); Store.change(s => { s.uiState[`${kind}Filters`] = Object.fromEntries(new FormData(form)); }); apply(); });
      return el('details', { class: 'filters-panel', open: window.innerWidth >= 768 }, el('summary', {}, 'Поиск и фильтры', Object.values(saved).some(Boolean) ? ' · применены' : ''), form);
    },
    render(main, kind) {
      main.append(UI.heading(kind === 'tasks' ? 'Задачи' : 'Входящие', kind === 'tasks' ? 'Сначала результат. Затем — место для него в календаре.' : 'Выгрузи мысли. Разбирай их в удобном темпе.', button(kind === 'tasks' ? '+ Добавить задачу' : '+ Добавить запись', () => kind === 'tasks' ? this.taskEditor() : this.inboxAdd(), 'primary')));
      const draft = Store.state.uiState[kind === 'tasks' ? 'taskDraft' : 'inboxDraft']; if (draft) main.append(button('Продолжить черновик', () => kind === 'tasks' ? this.taskEditor(draft.task, draft.sourceId) : this.inboxAdd(draft), 'small'));
      if (kind === 'inbox' && Store.state.uiState.inboxEditDraft) main.append(button('Продолжить разбор', () => this.inboxDetails(Store.state.uiState.inboxEditDraft), 'small'));
      main.append(this.filters(kind, () => UI.render()));
      const f = Store.state.uiState[`${kind}Filters`] || {}, rows = (kind === 'tasks' ? Store.state.tasks : Store.state.brainDumpItems).filter(x => SearchService.matches(x, kind, f));
      rows.sort((a, b) => kind === 'tasks' && f.sort === 'leverage' ? b.leverage - a.leverage || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt));
      main.append(el('p', { class: 'hint', role: 'status' }, `Найдено: ${rows.length}`));
      if (!rows.length) main.append(el('section', { class: 'panel empty' }, el('h2', {}, 'Здесь пока пусто'), el('p', { class: 'subtitle' }, 'Добавь запись или измени фильтры.')));
      main.append(el('div', { class: 'work-list' }, rows.map(item => kind === 'tasks' ? this.taskCard(item) : this.inboxCard(item))));
    },
    taskCard(t) {
      return el('article', { class: 'panel work-card', 'data-task-id': t.id }, el('div', { class: 'section-head' }, el('h2', {}, t.title), el('span', { class: 'pill' }, TASK_STATUSES[t.status])), el('p', { class: 'hint' }, `${CalendarUI.area(t.areaId).name} · Рычаг ${t.leverage} / 5 · ${ENERGY_NAMES[t.energyRequired]}${t.deadline ? ` · До ${Utils.dateLabel(t.deadline)}` : ''}`), t.minimumVersion ? el('p', { class: 'minimum-version' }, el('strong', {}, 'Минимальная версия: '), t.minimumVersion) : null, el('p', { class: 'hint' }, `Оценка: ${this.factText(t.estimatedMinutes)} · Факт: ${this.factText(t.actualMinutes)}${t.actualMinutesManualOverride ? ' · вручную' : ''} · Блоков: ${(t.blockIds || []).length}`), t.tags?.length ? el('p', { class: 'hint' }, t.tags.map(x => `#${x}`).join(' ')) : null, el('div', { class: 'actions' }, button('Открыть задачу', () => this.taskDetails(t), 'primary small'), button('Запланировать', () => this.planTask(t), 'small'), t.status !== 'completed' ? button('Завершить задачу', () => { TaskService.status(t.id, 'completed'); UI.render(); }, 'small') : null));
    },
    taskDetails(t) {
      const body = el('div', {}, el('p', { class: 'subtitle' }, `${TASK_STATUSES[t.status]} · ${CalendarUI.area(t.areaId).name}`), el('p', {}, `Оценка: ${this.factText(t.estimatedMinutes)}. Факт: ${this.factText(t.actualMinutes)}${t.actualMinutesManualOverride ? ' (вручную)' : ''}.`), t.minimumVersion ? el('p', { class: 'minimum-version' }, 'Минимальная версия: ', t.minimumVersion) : null, el('p', { class: 'block-note' }, t.notes), el('div', { class: 'actions' }, button('Редактировать задачу', () => this.taskEditor(t), 'primary'), button('Запланировать', () => this.planTask(t)), button('Связать с блоками', () => this.taskLinks(t))));
      body.append(el('div', { class: 'actions' }, button('Запустить таймер задачи', () => FocusUI.open(t.id), 'primary small'), t.actualMinutesManualOverride ? button('Использовать время Таймера фокуса', () => { FocusService.useTimer(t.id); UI.render(); this.taskDetails(Store.state.tasks.find(x => x.id === t.id)); }, 'small') : null));
      const names = { inbox: 'Вернуть во входящие', planned: 'Запланирована', in_progress: 'Начать', completed: 'Завершить задачу', postponed: 'Отложить', cancelled: 'Отменить задачу' };
      body.append(el('div', { class: 'block-status-actions' }, Object.entries(names).filter(([s]) => s !== t.status).map(([s, name]) => button(name, () => { TaskService.status(t.id, s); UI.render(); this.taskDetails(Store.state.tasks.find(x => x.id === t.id)); }, 'small'))));
      const blocks = Store.state.calendarBlocks.filter(b => b.taskIds?.includes(t.id));
      body.append(el('h3', { style: 'margin-top:24px' }, 'Календарные блоки'), blocks.length ? el('div', { class: 'work-list' }, blocks.map(b => button(`${Utils.dateLabel(b.startDateTime.slice(0, 10))} ${b.startDateTime.slice(11)} · ${b.title} · ${BLOCK_STATUSES[b.status]}`, () => CalendarUI.details(b), 'small'))) : el('p', { class: 'hint' }, 'Пока нет блоков. Можно распределить задачу на несколько отрезков времени.'));
      body.append(el('div', { class: 'form-footer' }, button('Закрыть', () => UI.close()), button('Удалить задачу', () => this.confirmDelete('Удалить задачу?', 'Календарные блоки останутся, их связь с задачей будет снята.', () => TaskService.remove(t.id), () => this.taskDetails(t)), 'danger'))); UI.open(t.title, body);
    },
    taskEditor(task = null, sourceId = null) {
      const t = task ? Utils.clone(task) : TaskService.fresh(), form = el('form'), err = el('p', { class: 'error', role: 'alert' });
      form.append(el('div', { class: 'form-grid' }, field('Название задачи', input('title', t.title, 'text', { required: true, maxlength: 120 })), field('Сфера задачи', select('areaId', t.areaId, AreaService.ordered().map(a => [a.id, a.name]))), ...[['importance', 'Важность'], ['urgency', 'Срочность'], ['leverage', 'Рычаг']].map(([k, name]) => field(name, input(k, t[k], 'number', { min: 1, max: 5, step: 1, required: true }))), field('Энергия задачи', select('energyRequired', t.energyRequired, Object.entries(ENERGY_NAMES))), field('Статус задачи', select('status', t.status, Object.entries(TASK_STATUSES))), field('Дедлайн задачи', input('deadline', t.deadline || '', 'date')), field('Оценка, минут', input('estimatedMinutes', t.estimatedMinutes ?? '', 'number', { min: 1, step: 1 })), field('Факт задачи, минут', input('actualMinutes', t.actualMinutes ?? '', 'number', { min: 0, step: 1 }), 'Пусто — нет данных. Введённое число заменяет прежний факт.')));
      form.append(field('Минимальная версия', this.textarea('minimumVersion', t.minimumVersion, 500)), field('Заметки задачи', this.textarea('notes', t.notes, 2000)), field('Теги через запятую', input('tags', (t.tags || []).join(', ')), 'До 10 тегов по 30 символов.'), err);
      const read = () => { const f = new FormData(form), actual = Utils.number(f.get('actualMinutes')); return { ...t, title: f.get('title').trim(), areaId: f.get('areaId'), importance: Number(f.get('importance')), urgency: Number(f.get('urgency')), leverage: Number(f.get('leverage')), energyRequired: f.get('energyRequired'), status: f.get('status'), deadline: f.get('deadline') || null, estimatedMinutes: Utils.number(f.get('estimatedMinutes')), actualMinutes: actual, actualMinutesManualOverride: actual === null ? false : actual !== t.actualMinutes || t.actualMinutesManualOverride, minimumVersion: f.get('minimumVersion'), notes: f.get('notes'), tags: [...new Set(f.get('tags').split(',').map(x => x.trim()).filter(Boolean))] }; };
      form.addEventListener('input', e => Store.change(s => { s.uiState.taskDraft = { task: read(), sourceId }; }, e.target.type === 'text' || e.target.tagName === 'TEXTAREA')); form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); try { TaskService.save(read(), sourceId); UI.close(); UI.render(); UI.toast('Задача сохранена'); } catch (e) { err.textContent = e.message; } });
      form.append(el('div', { class: 'form-footer' }, button('Отмена', () => { Store.change(s => { delete s.uiState.taskDraft; }); UI.close(); }), el('button', { class: 'button primary', type: 'submit' }, 'Сохранить задачу'))); UI.open(task ? 'Редактировать задачу' : 'Новая задача', form);
    },
    planTask(t) { const date = CalendarUI.date(), minutes = Math.min(1440, t.estimatedMinutes || 60); CalendarUI.editor(null, { title: t.title, primaryAreaId: t.areaId, protected: CalendarUI.area(t.areaId).protected, energyRequired: t.energyRequired, startDateTime: `${date}T09:00`, endDateTime: DateUtils.stamp(DateUtils.minute(`${date}T09:00`) + minutes), taskIds: [t.id] }); },
    taskLinks(t, date = CalendarUI.date()) {
      const week = DateUtils.weekStart(date), blocks = RecurrenceService.blocks(Store.state, week, DateUtils.add(week, 6)).filter(activeBlock), form = el('form');
      const picker = input('linkDate', date, 'date', { 'aria-label': 'Неделя для связи' }); picker.addEventListener('change', () => { if (picker.value) this.taskLinks(t, picker.value); });
      form.append(field('Неделя для связи', picker), el('p', { class: 'hint' }, 'Выбери блоки этой недели. Связи других недель сохранятся. Выбор повтора относится к одному экземпляру.'), el('div', { class: 'link-choices' }, blocks.map(b => check(`${Utils.dateLabel(b.startDateTime.slice(0, 10))} ${b.startDateTime.slice(11)} · ${b.title}`, `link_${b.id}`, t.blockIds.includes(b.id)))));
      form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form), others = Store.state.calendarBlocks.filter(b => t.blockIds.includes(b.id) && !blocks.some(x => x.id === b.id)); TaskService.links(t.id, [...others, ...blocks.filter(b => f.has(`link_${b.id}`))]); UI.render(); this.taskDetails(Store.state.tasks.find(x => x.id === t.id)); });
      form.append(el('div', { class: 'form-footer' }, button('Отмена', () => this.taskDetails(t)), el('button', { class: 'button primary', type: 'submit' }, 'Сохранить связи'))); UI.open('Связать задачу с блоками', form);
    },
    inboxAdd(draft = {}) {
      const form = el('form'), err = el('p', { class: 'error', role: 'alert' });
      form.append(field('Мысли и дела', el('textarea', { name: 'text', required: true, rows: 8 }, draft.text || '')), check('Каждая строка — отдельная запись', 'split', draft.split !== false), field('Категория записи', select('category', draft.category || 'thought', Object.entries(INBOX_CATEGORIES))), el('p', { class: 'hint' }, 'До 2000 символов в каждой записи. Пустые строки пропускаются.'), el('small', { class: 'counter', id: 'inbox-counter' }), err);
      const read = () => { const f = new FormData(form); return { text: f.get('text'), split: f.has('split'), category: f.get('category') }; };
      const capture = () => { const d = read(); Store.change(s => { s.uiState.inboxDraft = d; }, true); const max = Math.max(0, ...(d.split ? d.text.split(/\r?\n/) : [d.text]).map(x => x.length)); const c = form.querySelector('.counter'); c.hidden = max < 1600; c.textContent = `${max} / 2000 в самой длинной записи`; };
      form.addEventListener('input', capture); form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); try { const d = read(); InboxService.add(d.text, d.split, d.category); UI.close(); UI.render(); } catch (e) { err.textContent = e.message; } });
      form.append(el('div', { class: 'form-footer' }, button('Отмена', () => { Store.change(s => { delete s.uiState.inboxDraft; }); UI.close(); }), el('button', { class: 'button primary', type: 'submit' }, 'Добавить во входящие'))); UI.open('Выгрузить мысли', form);
    },
    inboxCard(i) { return el('article', { class: 'panel work-card', 'data-inbox-id': i.id }, el('p', { class: 'block-note' }, i.text), el('p', { class: 'hint' }, `${INBOX_CATEGORIES[i.category]} · ${i.processed ? 'Разобрано' : 'Ожидает разбора'}`), el('div', { class: 'actions' }, button('Разобрать запись', () => this.inboxDetails(i), 'primary small'), button(i.processed ? 'Вернуть из архива' : 'Отметить разобранной', () => { InboxService.update(i.id, { processed: !i.processed }); UI.render(); }, 'small'))); },
    inboxDetails(i) {
      if (Store.state.uiState.inboxEditDraft?.id === i.id) i = Store.state.uiState.inboxEditDraft;
      const form = el('form'), err = el('p', { class: 'error', role: 'alert' }); form.append(field('Текст записи', this.textarea('text', i.text, 2000)), field('Категория записи', select('category', i.category, Object.entries(INBOX_CATEGORIES))), check('Разобрано · в архиве', 'processed', i.processed), err);
      form.addEventListener('input', e => Store.change(s => { s.uiState.inboxEditDraft = { ...i, text: form.elements.text.value, category: form.elements.category.value, processed: form.elements.processed.checked }; }, e.target.tagName === 'TEXTAREA')); form.addEventListener('focusout', () => Store.save());
      form.addEventListener('submit', e => { e.preventDefault(); try { const f = new FormData(form); InboxService.update(i.id, { text: f.get('text'), category: f.get('category'), processed: f.has('processed') }); UI.close(); UI.render(); } catch (e) { err.textContent = e.message; } });
      const convert = kind => { const current = { ...i, text: form.elements.text.value, category: form.elements.category.value }; try { InboxService.update(i.id, current); if (kind === 'task') { if (i.convertedTaskId) { const t = Store.state.tasks.find(t => t.id === i.convertedTaskId); if (t) return this.taskDetails(t); } this.taskEditor({ ...TaskService.fresh(), title: current.text.slice(0, 120), notes: current.text }, i.id); } else { if (i.convertedBlockId) { const b = Store.state.calendarBlocks.find(b => b.id === i.convertedBlockId); if (b) return CalendarUI.details(b); } CalendarUI.editor(null, { title: current.text.slice(0, 120), note: current.text, sourceInboxId: i.id }); } } catch (e) { err.textContent = e.message; } };
      form.append(el('div', { class: 'actions' }, button(i.convertedTaskId ? 'Открыть созданную задачу' : 'Преобразовать в задачу', () => convert('task')), button(i.convertedBlockId ? 'Открыть созданный блок' : 'Преобразовать в блок', () => convert('block'))), el('div', { class: 'form-footer' }, button('Удалить запись', () => this.confirmDelete('Удалить запись?', 'Созданные из неё задачи и блоки останутся.', () => InboxService.remove(i.id), () => this.inboxDetails(i)), 'danger'), el('button', { class: 'button primary', type: 'submit' }, 'Сохранить запись'))); UI.open('Разбор входящей записи', form);
    },
    confirmDelete(title, text, action, cancel) { UI.open(title, el('div', {}, el('p', {}, text), el('div', { class: 'form-footer' }, button('Отмена', cancel), button('Удалить', () => { action(); UI.close(); UI.render(); }, 'danger')))); },
    blockFact(b) {
      const form = el('form'), err = el('p', { class: 'error', role: 'alert' }); form.append(el('p', {}, `План: ${Utils.formatMinutes(b.plannedMinutes)}. Факт не меняет положение блока и плановую ёмкость.`), field('Факт блока, минут', input('actual', b.actualMinutes ?? '', 'number', { min: 0, max: 1440, step: 1 }), 'Пусто — нет данных, 0 — зафиксированный ноль.'), err);
      form.addEventListener('submit', e => { e.preventDefault(); CalendarUI.submit({ old: b, block: { ...b, actualMinutes: Utils.number(form.elements.actual.value) } }, () => this.blockFact(b), err); }); form.append(el('div', { class: 'form-footer' }, button('Отмена', () => CalendarUI.details(b)), el('button', { class: 'button primary', type: 'submit' }, 'Сохранить факт'))); UI.open('Фактическое время блока', form);
    },
    reservationFact(r) {
      const f = Store.state.reservationFacts?.find(f => f.reservationId === r.id), form = el('form'), err = el('p', { class: 'error', role: 'alert' });
      form.append(el('p', { class: 'subtitle' }, `${Utils.dateLabel(r.startDateTime.slice(0, 10))} · ${r.startDateTime.slice(11)}–${r.endDateTime.slice(11)}. Факт: ${this.factText(f?.actualMinutes)}`), field('Фактическое начало', input('start', f?.actualStartDateTime || r.startDateTime, 'datetime-local', { required: true })), field('Фактическое окончание', input('end', f?.actualEndDateTime || r.endDateTime, 'datetime-local', { required: true })), err);
      const save = mode => UI.confirmHistory(r.startDateTime.slice(0, 10), () => { try { FactService.reservation(r.id, mode, form.elements.start.value, form.elements.end.value); UI.close(); UI.render(); } catch (e) { err.textContent = e.message; UI.toast(e.message); } }, () => this.reservationFact(r));
      form.addEventListener('submit', e => { e.preventDefault(); save('manual'); }); form.append(el('div', { class: 'form-footer' }, button('Не фиксировать', () => save(null)), button('По плану', () => save('planned_as_actual'), 'primary'), el('button', { class: 'button', type: 'submit' }, 'Изменить'))); UI.open(r.type === 'work' ? 'Рабочий день: подтвердить факт' : 'Рабочая дорога: подтвердить факт', form);
    },
    dailyFacts(main, date) { const rows = FactService.dayReservations(Store.state, date); if (!rows.length) return; main.append(el('section', { class: 'panel daily-facts' }, el('h2', {}, 'Факт выбранного дня'), el('p', { class: 'hint' }, `${Utils.dateLabel(date)} · Подтверждение добровольное. Детали внутри рабочего резерва не прибавляются к его факту.`), el('div', { class: 'actions' }, rows.map(r => button(`${r.type === 'work' ? 'Рабочий день' : 'Дорога'} ${r.startDateTime.slice(11)}–${r.endDateTime.slice(11)} · ${this.factText(Store.state.reservationFacts?.find(f => f.reservationId === r.id)?.actualMinutes)}${r.savedFact ? ' · прежний график' : ''}`, () => this.reservationFact(r), 'small'))))); },
    factBudget(main, week) { const f = FactService.calculate(Store.state, week); main.append(el('section', { class: 'panel daily-facts' }, el('h2', {}, 'Жизнь вне работы'), el('p', {}, `План: ${f.planPercent == null ? 'нет данных' : `${Math.round(f.planPercent)}%`} · Факт: ${f.factPercent == null ? 'недостаточно данных' : `${Math.round(f.factPercent)}%${f.partial ? ' · частичные данные' : ''}`}`), el('p', { class: 'hint' }, 'Расчёт использует запланированный сон и зафиксированное фактическое рабочее время. Факт задачи не добавляется к времени блоков. Для блоков без фактических границ время распределяется по долям планового интервала.'), el('p', {}, `Работа, факт: ${this.factText(f.work)} · Подтверждённая дорога: ${this.factText(f.commute)}`))); return f; },
    search() {
      const form = el('form'), query = input('query', Store.state.uiState.globalQuery || '', 'search'), date = input('date', CalendarUI.date(), 'date', { required: true }), results = el('div', { class: 'work-list' });
      form.append(field('Искать во всех разделах', query), field('Неделя повторяющихся блоков', date), el('button', { class: 'button primary', type: 'submit' }, 'Найти'), el('p', { class: 'hint' }, 'Задачи, входящие и сохранённые блоки — за всё время. Несохранённые экземпляры повторов — за выбранную неделю.'), results);
      form.addEventListener('submit', e => { e.preventDefault(); Store.change(s => { s.uiState.globalQuery = query.value; }); const week = DateUtils.weekStart(date.value), all = new Map(Store.state.calendarBlocks.map(b => [b.id, b])); for (const b of RecurrenceService.blocks(Store.state, week, DateUtils.add(week, 6))) all.set(b.id, b); results.replaceChildren(); let count = 0; for (const [kind, items, open] of [['tasks', Store.state.tasks, x => this.taskDetails(x)], ['inbox', Store.state.brainDumpItems, x => this.inboxDetails(x)], ['blocks', [...all.values()], x => CalendarUI.details(x)]]) for (const item of items) if (SearchService.matches(item, kind, { query: query.value, archive: 'all' })) { count++; results.append(button(`${kind === 'tasks' ? 'Задача' : kind === 'inbox' ? 'Входящие' : 'Блок'} · ${item.title || item.text}`, () => open(item), 'small')); } results.prepend(el('p', { class: 'hint', role: 'status' }, `Найдено: ${count}`)); }); UI.open('Поиск', form);
    }
  };
  const FocusUI = {
    announce(message) {
      UI.toast(message);
      const p = EnergyService.prefs();
      if (p.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') try { new Notification('168 · Пространство для Жизни', { body: message }); } catch { /* Внутреннее уведомление уже показано. */ }
      if (p.sound && this.audio) try { const ctx = this.audio, osc = ctx.createOscillator(), gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 660; gain.gain.setValueAtTime(.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .35); osc.start(); osc.stop(ctx.currentTime + .35); } catch { /* Браузер может блокировать звук. */ }
    },
    unlockAudio() { if (!EnergyService.prefs().sound) return; try { this.audio ||= new (window.AudioContext || window.webkitAudioContext)(); this.audio.resume().catch(() => {}); } catch { /* Звук недоступен. */ } },
    refresh() {
      if (Store.blocked) return;
      const today = Utils.localDate();
      if (this.lastDate && this.lastDate !== today) Store.change(s => AnalyticsService.sync(s));
      if (this.lastDate && this.lastDate !== today && Store.state.uiState.activeSection === 'week' && !document.querySelector('dialog').open) UI.render();
      this.lastDate = today;
      const before = FocusService.timer()?.status, events = FocusService.tick(); events.forEach(e => this.announce(e));
      if (events.length && Store.state.weekSnapshots.some(s => s.needsRecalculation)) Store.change(s => AnalyticsService.sync(s));
      const t = FocusService.timer();
      if (before === 'running' && t?.status === 'ready' && Store.state.uiState.activeSection === 'focus' && !document.querySelector('dialog').open) UI.render();
      const node = document.querySelector('[data-countdown]'); if (node && t) { const seconds = Math.max(0, Math.ceil((t.durationMs - FocusService.elapsed(t)) / 1000)); node.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
      const now = Date.now(), date = Utils.localDate();
      const key = Math.floor(now / 15000); if (this.notificationTick === key) return; this.notificationTick = key;
      const rows = RecurrenceService.blocks(Store.state, date, DateUtils.add(date, 1)).filter(b => b.protected && activeBlock(b));
      for (const b of rows) { const start = +new Date(b.startDateTime), id = `${b.id}:${b.startDateTime}`; if (start > now && start - now <= 600000 && !Store.state.uiState.protectedNotices?.[id]) { Store.change(s => { s.uiState.protectedNotices ||= {}; s.uiState.protectedNotices[id] = start; for (const [k, v] of Object.entries(s.uiState.protectedNotices)) if (v < now - 86400000) delete s.uiState.protectedNotices[k]; }); this.announce(`Скоро защищённый блок «${b.title}» · ${b.startDateTime.slice(11)}.`); } }
    },
    init() { if (this.interval) clearInterval(this.interval); this.interval = setInterval(() => this.refresh(), 1000); this.refresh(); },
    open(taskId = null, block = null) {
      if (block?.virtual) { const old = block; Store.change(s => { block = { ...old, id: Utils.id(), virtual: undefined }; RecurrenceService.exception(s, old, block); TaskService.reconcile(s); }); }
      if (block?.taskIds?.length === 1 && !taskId) taskId = block.taskIds[0];
      Store.change(s => { s.uiState.focusDraft = { ...(s.uiState.focusDraft || {}), taskId, ...(block ? { blockId: block.id } : { blockId: undefined }) }; }); UI.close(); UI.navigate('focus');
    },
    render(main) {
      main.append(UI.heading('Фокус', 'Один рабочий интервал. В своём темпе.'));
      const t = FocusService.timer();
      if (t && t.status !== 'stopped') {
        const title = Store.state.tasks.find(x => x.id === t.taskId)?.title || Store.state.calendarBlocks.find(b => b.id === t.blockId)?.title || 'Без задачи';
        const panel = el('section', { class: 'panel focus-panel' }, el('p', { class: 'eyebrow' }, t.phase === 'work' ? 'РАБОТА' : t.completedCycles % 4 === 0 ? 'ДЛИННЫЙ ПЕРЕРЫВ' : 'ОТДЫХ'), el('h2', {}, title), el('div', { class: 'focus-clock', 'data-countdown': '', role: 'timer', 'aria-label': 'Осталось времени' }, this.timeText(t)), el('p', { class: 'hint', role: 'status' }, `${t.status === 'paused' ? 'На паузе' : t.status === 'ready' ? 'Готов к запуску' : 'Идёт отсчёт'} · Рабочих циклов: ${t.completedCycles}`));
        panel.append(el('p', { class: 'hint' }, 'Сфера: ' + CalendarUI.area(FocusService.scopeArea(t)).name));
        const act = (f, message) => { try { FocusService.writable(); this.unlockAudio(); const result = f(); if (message || result) this.announce(message || result); UI.render(); } catch (e) { UI.toast(e.message); } };
        panel.append(el('div', { class: 'actions focus-actions' }, t.status === 'running' ? button('Пауза', () => act(() => FocusService.pause()), 'primary') : t.status === 'paused' ? button('Продолжить', () => act(() => FocusService.resume()), 'primary') : button(t.phase === 'work' ? 'Следующий цикл' : 'Начать отдых', () => act(() => FocusService.next()), 'primary'), t.phase === 'work' && t.status !== 'ready' ? button('Завершить раньше', () => act(() => FocusService.finish())) : null, t.phase === 'break' ? button('Пропустить отдых', () => act(() => FocusService.skipBreak())) : null, button('Остановить сессию', () => act(() => FocusService.finish(Date.now(), true), 'Сессия остановлена. Завершённые рабочие минуты сохранены.'), 'danger')));
        panel.append(el('p', { class: 'hint' }, 'Пауза и отдых не входят в факт. После завершения следующий интервал запускается вручную. При остановке учитываются полные рабочие минуты.')); main.append(panel);
      } else this.startForm(main);
      const history = Store.state.focusSessions.filter(f => f.kind === 'work').slice(-5).reverse();
      if (history.length) main.append(el('section', { class: 'panel daily-facts' }, el('h2', {}, 'Последние рабочие интервалы'), history.map(f => el('p', { class: 'hint' }, CalendarUI.area(f.areaId).name + ' · ', `${Utils.dateLabel(Utils.localDate(new Date(f.endedAt)))} · ${WorkUI.factText(f.actualMinutes)} · ${Store.state.tasks.find(t => t.id === f.taskId)?.title || 'Без задачи'}${f.blockId ? ' · с привязкой к блоку' : ''}`))));
    },
    timeText(t) { const seconds = Math.max(0, Math.ceil((t.durationMs - FocusService.elapsed(t)) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; },
    startForm(main) {
      const d = Store.state.uiState.focusDraft || {}, config = Store.state.settings.focus, form = el('form', { class: 'panel focus-setup' }), err = el('p', { class: 'error', role: 'alert' });
      const task = select('taskId', d.taskId || '', [['', 'Без задачи'], ...Store.state.tasks.filter(t => !['completed', 'cancelled'].includes(t.status) || t.id === d.taskId).map(t => [t.id, t.title])]);
      const blocks = el('select', { name: 'blockId', 'aria-label': 'Блок для факта' });
      const populate = (useDraft = false) => { const choices = task.value ? FocusService.choices(task.value) : Store.state.calendarBlocks.filter(b => activeBlock(b) && b.startDateTime.slice(0, 10) === Utils.localDate()); if (d.blockId && !choices.some(b => b.id === d.blockId)) { const b = Store.state.calendarBlocks.find(b => b.id === d.blockId); if (b && (!task.value || b.taskIds?.includes(task.value))) choices.push(b); } blocks.replaceChildren(...[['', 'Без привязки к блоку'], ...choices.map(b => [b.id, `${b.startDateTime.slice(11)} · ${b.title}`])].map(([value, label]) => el('option', { value }, label))); if (task.value && choices.length > 1) { blocks.prepend(el('option', { value: 'choose' }, 'Выбери блок или отсутствие привязки')); blocks.value = 'choose'; } else blocks.value = task.value && choices.length === 1 && choices[0].startDateTime.slice(0, 10) === Utils.localDate() ? choices[0].id : ''; if (useDraft && Object.hasOwn(d, 'blockId')) blocks.value = d.blockId || ''; };
      populate(true); task.addEventListener('change', () => populate());
      const selectedArea = Store.state.calendarBlocks.find(b => b.id === blocks.value)?.primaryAreaId || Store.state.tasks.find(t => t.id === task.value)?.areaId || d.areaId || Store.state.lifeAreas.find(a => a.systemType === 'uncategorized').id;
      const area = select('areaId', selectedArea, AreaService.ordered().filter(a => !a.hidden || a.id === selectedArea || a.systemType).map(a => [a.id, a.name]));
      const syncArea = () => { const id = Store.state.calendarBlocks.find(b => b.id === blocks.value)?.primaryAreaId || Store.state.tasks.find(t => t.id === task.value)?.areaId; if (id) { if (![...area.options].some(o => o.value === id)) area.append(el('option', { value: id }, CalendarUI.area(id).name)); area.value = id; } };
      task.addEventListener('change', syncArea); blocks.addEventListener('change', syncArea);
      area.addEventListener('change', () => { task.value = ''; populate(); blocks.value = ''; });
      form.append(field('Сфера фокуса', area, 'Можно запустить фокус только для сферы. Выбор другой сферы снимает привязку к задаче и блоку.'));
      const work = input('workMinutes', d.workMinutes || config.workMinutes, 'number', { min: 1, max: 1440, step: 1, required: true }), rest = input('breakMinutes', d.breakMinutes || config.breakMinutes, 'number', { min: 1, max: 1440, step: 1, required: true });
      const mode = select('mode', 'custom', [['25/5', '25 / 5'], ['50/10', '50 / 10'], ['75/15', '75 / 15'], ['30/5', '30 / 5'], ['custom', 'Пользовательский']]); mode.value = ['25/5', '50/10', '75/15', '30/5'].includes(`${work.value}/${rest.value}`) ? `${work.value}/${rest.value}` : 'custom'; mode.addEventListener('change', () => { if (mode.value !== 'custom') [work.value, rest.value] = mode.value.split('/'); }); for (const n of [work, rest]) n.addEventListener('input', () => { mode.value = 'custom'; });
      form.append(el('div', { class: 'form-grid' }, field('Задача для фокуса', task), field('Блок для факта', blocks), field('Режим таймера', mode), field('Работа, минут', work), field('Отдых, минут', rest), field('Длинный перерыв, минут', input('longBreakMinutes', d.longBreakMinutes || config.longBreakMinutes, 'number', { min: 1, max: 1440, required: true }))), el('p', { class: 'hint' }, 'После четырёх рабочих циклов — длинный перерыв. Если блоков несколько, выбери один или «Без привязки к блоку».'), err, el('button', { class: 'button primary', type: 'submit' }, 'Начать фокус'));
      const read = () => ({ taskId: task.value || null, areaId: area.value, blockId: blocks.value === 'choose' ? undefined : blocks.value || null, workMinutes: Number(work.value), breakMinutes: Number(rest.value), longBreakMinutes: Number(form.elements.longBreakMinutes.value) });
      form.addEventListener('change', () => Store.change(s => { s.uiState.focusDraft = read(); }));
      form.addEventListener('submit', e => { e.preventDefault(); try { if (blocks.value === 'choose') throw Error('Выбери блок или «Без привязки к блоку».'); this.unlockAudio(); FocusService.start(read()); UI.render(); } catch (e) { err.textContent = e.message; } }); main.append(form);
    },
    today(main) {
      const date = Utils.localDate(), now = Date.now(); CalendarService.openWeek(date);
      const start = DateUtils.minute(`${date}T00:00`), data = BudgetService.calculate(Store.state, date, [start, start + 1440]);
      const blocks = RecurrenceService.blocks(Store.state, date, date).filter(b => activeBlock(b) && +new Date(b.endDateTime) > now).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)).slice(0, 3);
      const tasks = Store.state.tasks.filter(t => !['completed', 'cancelled', 'postponed'].includes(t.status)).sort((a, b) => b.leverage - a.leverage || b.importance - a.importance || b.urgency - a.urgency).slice(0, 3);
      const energy = select('todayEnergy', Store.state.dailyEnergy?.[date] || '', [['', 'Пока не отмечена'], ...Object.entries(ENERGY_NAMES)]); energy.addEventListener('change', () => { EnergyService.set(date, energy.value); UI.render(); });
      const panel = el('section', { class: 'panel today-panel' }, el('div', { class: 'section-head' }, el('h2', {}, `Сегодня · ${Utils.dateLabel(date)}`), button('Открыть фокус', () => this.open(), 'primary small')), field('Энергия сегодня', energy), el('p', { class: 'hint' }, `Свободное время сегодня: ${Utils.formatMinutes(data.free)}`), el('div', { class: 'today-columns' }, el('div', {}, el('h3', {}, 'Ближайшие блоки'), blocks.length ? blocks.map(b => el('div', { class: 'today-item' }, button(`${b.startDateTime.slice(11)} · ${b.title}`, () => CalendarUI.details(b), 'small'), EnergyService.warning(b) ? el('p', { class: 'hint' }, EnergyService.warning(b)) : null)) : el('p', { class: 'hint' }, 'Больше нет ближайших блоков.')), el('div', {}, el('h3', {}, 'Приоритетные задачи'), tasks.length ? tasks.map(t => button(t.title, () => WorkUI.taskDetails(t), 'small')) : el('p', { class: 'hint' }, 'Нет активных задач.'))));
      WorkUI.dailyFacts(panel, date); main.append(panel);
    },
    preferences(main) {
      const p = EnergyService.prefs(), form = el('form', { class: 'panel daily-facts' }), err = el('p', { class: 'error', role: 'alert' });
      form.append(el('h2', {}, 'Энергия и сигналы'), check('Звук таймера', 'sound', p.sound), check('Браузерные уведомления', 'browserNotifications', p.browserNotifications), button('Разрешить уведомления', async () => { if (typeof Notification === 'undefined') { UI.toast('В этом браузере доступны внутренние уведомления.'); return; } try { const result = await Notification.requestPermission(); UI.toast(result === 'granted' ? 'Разрешение получено. Включи браузерные уведомления и сохрани настройки.' : 'Будут использоваться внутренние уведомления.'); } catch { UI.toast('Будут использоваться внутренние уведомления.'); } }, 'small'), check('Напоминать о смене положения', 'postureEnabled', p.postureEnabled), field('Порог напоминания, минут', input('postureMinutes', p.postureMinutes, 'number', { min: 1, max: 1440, required: true })), el('p', { class: 'hint' }, 'Напоминание отсчитывает только рабочее время текущего интервала. При закрытой странице сигналы недоступны; таймер восстановится при открытии.'), el('h3', {}, 'Типичная энергия по времени суток'), el('div', { class: 'form-grid' }, [['night', 'Ночь · 00:00–06:00'], ['morning', 'Утро · 06:00–12:00'], ['afternoon', 'День · 12:00–18:00'], ['evening', 'Вечер · 18:00–24:00']].map(([key, label]) => field(label, select(key, p.energyProfile[key] || '', [['', 'Не задана'], ...Object.entries(ENERGY_NAMES)])))), err, el('button', { class: 'button primary', type: 'submit' }, 'Сохранить энергию и сигналы'));
      form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form), threshold = Number(f.get('postureMinutes')); if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1440) { err.textContent = 'Порог — от 1 до 1440 целых минут.'; return; } Store.change(s => { s.settings.focusPreferences = { sound: f.has('sound'), browserNotifications: f.has('browserNotifications'), postureEnabled: f.has('postureEnabled'), postureMinutes: threshold, energyProfile: Object.fromEntries(['night', 'morning', 'afternoon', 'evening'].map(k => [k, f.get(k)])) }; }); this.unlockAudio(); UI.render(); UI.toast('Энергия и сигналы сохранены'); }); main.append(form);
    }
  };
  // Снимки содержат готовые числа и подписи: изменение нормативов не переписывает историю.
  const AnalyticsService = {
    calculate(s, date) {
      const week = DateUtils.weekStart(date), bounds = DateUtils.bounds(week), b = BudgetService.calculate(s, week), f = FactService.calculate(s, week);
      const blocks = RecurrenceService.blocks(s, week, DateUtils.add(week, 6));
      for (const block of s.calendarBlocks) if (!blocks.some(x => x.id === block.id) && Object.values(block.timerCredits || {}).some(c => c.weekMinutes?.[DateUtils.weekId(week)])) blocks.push(block);
      const minutes = block => Intervals.length([Intervals.clip(Intervals.of(block), ...bounds)]);
      const rows = s.lifeAreas.map(a => {
        const primary = blocks.filter(x => x.primaryAreaId === a.id), all = blocks.filter(x => x.primaryAreaId === a.id || x.additionalAreaIds?.includes(a.id));
        const fact = list => list.some(x => x.actualMinutes != null) ? Math.round(list.reduce((n, x) => n + (FactService.portion(x, bounds) || 0), 0)) : null;
        const plan = all.reduce((n, x) => n + minutes(x), 0), actual = fact(all), normPlan = a.systemType === 'work' ? b.work : plan;
        const minimum = a.minimumHours === null ? null : Math.round(a.minimumHours * 60), maximum = a.maximumHours === null ? null : Math.round(a.maximumHours * 60);
        return { id: a.id, name: a.name, color: a.color, hidden: a.hidden, primaryPlan: primary.reduce((n, x) => n + minutes(x), 0), primaryFact: fact(primary), plan, fact: actual, partial: all.some(x => x.actualMinutes == null), normPartial: a.systemType === 'work' ? f.partial : all.some(x => x.actualMinutes == null), minimum, maximum, normPlan, normFact: a.systemType === 'work' ? f.work : actual, status: maximum !== null && normPlan > maximum ? 'Выше максимума' : minimum !== null && normPlan < minimum ? 'Ниже минимума' : minimum !== null ? 'Минимум достигнут' : maximum !== null ? 'Максимум не превышен' : a.comfortHours !== null ? 'Задан ориентир комфорта' : 'Норматив не задан' };
      });
      const candidates = [...b.reserves.map(r => ({ span: Intervals.clip(Intervals.of(r), ...bounds), key: r.type, rank: { sleep: 0, commute: 1, work: 2 }[r.type], id: r.id })), ...b.blocks.map(x => ({ span: x.span, key: x.primaryAreaId, rank: 3, id: x.id }))].filter(x => x.span).sort((x, y) => x.rank - y.rank || x.id.localeCompare(y.id));
      const points = [...new Set(candidates.flatMap(x => x.span))].sort((x, y) => x - y), physical = {};
      for (let i = 1; i < points.length; i++) { const x = candidates.find(c => c.span[0] <= points[i - 1] && c.span[1] >= points[i]); if (x) physical[x.key] = (physical[x.key] || 0) + points[i] - points[i - 1]; }
      const workId = s.lifeAreas.find(a => a.systemType === 'work').id, allLosses = ProtectionService.entries(s, week), losses = allLosses.filter(e => e.targetAreaId === workId), lost = losses.reduce((n, e) => n + Math.max(0, e.minutes - (e.resolvedMinutes || 0)), 0);
      const protectedBlocks = b.blocks.filter(x => x.protected && x.primaryAreaId !== workId), kept = protectedBlocks.reduce((n, x) => n + minutes(x), 0);
      return { modelVersion: 2, week, knownHistory: week >= (s.settings.effectiveFrom || Utils.monday()) || blocks.length > 0 || b.reserves.length > 0, weekId: DateUtils.weekId(week), physical: b.physical, free: b.free, waking: b.waking, target: b.target, demand: b.demand, overload: b.overload, conflict: b.conflict, sleep: b.sleep, work: b.work, status: b.status, rows, distribution: physical, lost, affectedAreas: [...new Set(losses.filter(e => e.minutes > (e.resolvedMinutes || 0)).map(e => s.lifeAreas.find(a => a.id === e.sourceAreaId)?.name || 'Без сферы'))], absorption: kept + lost ? lost / (kept + lost) * 100 : null, protectedCount: protectedBlocks.length, violatedCount: new Set(allLosses.filter(e => e.minutes > (e.resolvedMinutes || 0)).map(e => `${e.sourceSeriesId || e.sourceBlockId || e.id}@${e.date}`)).size, lifePlan: f.planPercent, lifeFact: f.factPercent, partial: f.partial };
    },
    snapshot(s, date) {
      const week = DateUtils.weekStart(date); if (week >= Utils.monday()) return this.calculate(s, week);
      let snap = s.weekSnapshots.find(x => x.weekId === DateUtils.weekId(week));
      if (!snap || snap.needsRecalculation || !snap.metrics) {
        ReservationService.ensure(s, week); const metrics = this.calculate(s, week), now = new Date().toISOString();
        if (!snap) { snap = { weekId: metrics.weekId, createdAt: now, sourceDataRevision: 0 }; s.weekSnapshots.push(snap); }
        const revision = Math.max((snap.builtRevision || 0) + 1, snap.sourceDataRevision || 1);
        Object.assign(snap, { metrics, updatedAt: now, sourceDataRevision: revision, builtRevision: revision, needsRecalculation: false });
      }
      const m = snap.metrics;
      if (m.modelVersion !== 2) {
        const workId = s.lifeAreas.find(a => a.systemType === 'work').id;
        for (const row of m.rows) {
          row.normPartial = row.id === workId ? m.partial : row.partial;
          if (row.status === 'Норматив не задан' && row.maximum != null) row.status = row.normPlan > row.maximum ? 'Выше максимума' : 'Максимум не превышен';
        }
        m.violatedCount = new Set(ProtectionService.entries(s, week).filter(e => e.minutes > (e.resolvedMinutes || 0)).map(e => [e.sourceSeriesId || e.sourceBlockId || e.id, e.date].join('@'))).size;
        m.modelVersion = 2; snap.sourceDataRevision = (snap.sourceDataRevision || 0) + 1; snap.builtRevision = snap.sourceDataRevision; snap.updatedAt = new Date().toISOString();
      }
      return m;
    },
    sync(s) {
      const current = Utils.monday(), dates = [s.settings.effectiveFrom, ...Object.keys(s.settings.materializedWeeks || {}), ...s.calendarBlocks.map(b => b.startDateTime?.slice(0, 10)), ...s.recurrenceSeries.map(r => r.startDate)].filter(d => d && d < current).sort();
      if (!dates.length) return;
      for (let week = DateUtils.weekStart(dates[0]); week < current; week = DateUtils.add(week, 7)) this.snapshot(s, week);
    },
    insights(m, previous) {
      const out = [m.status.label || m.status]; if (previous?.knownHistory === false) previous = null;
      if (m.conflict) out.push(`Пересечения занимают ${Utils.formatMinutes(m.conflict)}.`);
      if (m.lost) out.push(`Работа вытеснила ${Utils.formatMinutes(m.lost)} защищённого личного времени.${m.lost >= 180 ? ' Стоит вернуть место для себя.' : ''}`);
      if (m.lost && m.affectedAreas?.length) out.push(`Пострадавшие сферы: ${m.affectedAreas.join(', ')}.`);
      if (previous && m.lost !== previous.lost) out.push(`Вытеснение ${m.lost > previous.lost ? 'выросло' : 'снизилось'} на ${Utils.formatMinutes(Math.abs(m.lost - previous.lost))} относительно прошлой недели.`);
      if (previous && m.work > previous.work) out.push(`Работа выросла на ${Utils.formatMinutes(m.work - previous.work)} относительно прошлой недели.`);
      for (const r of m.rows.filter(x => !x.hidden && x.status === 'Ниже минимума')) out.push(`${r.name}: ниже минимума на ${Utils.formatMinutes(r.minimum - r.normPlan)}${previous?.rows.find(x => x.id === r.id)?.status === 'Ниже минимума' ? ', вторую неделю подряд' : ''}.`);
      for (const r of m.rows.filter(x => !x.hidden && x.status === 'Выше максимума')) out.push(`${r.name}: выше максимума на ${Utils.formatMinutes(r.normPlan - r.maximum)}.`);
      return out;
    }
  };
  const TransferService = {
    parse(raw) {
      try { return this.validate(raw); }
      catch (error) {
        if (error instanceof SyntaxError) throw Error('Файл не является корректным JSON. Выбери резервную копию приложения.');
        if (error instanceof TypeError || error instanceof RangeError) throw Error('Повреждена структура данных: проверь обязательные поля и их типы.');
        throw error;
      }
    },
    validate(raw) {
      const source = JSON.parse(raw); if (!source || !DataMigrations[source.dataVersion]) throw Error('Версия данных не поддерживается.');
      const inspect = o => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('Недопустимое служебное поле.'); inspect(v); } }; inspect(source);
      const s = Validation.state(DataMigrations[source.dataVersion](source));
      const object = v => v && typeof v === 'object' && !Array.isArray(v);
      const date = v => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) || !Number.isFinite(Date.parse(v))) throw Error('Повреждена дата записи.'); };
      const text = (v, max) => { if (typeof v !== 'string' || v.length > max) throw Error('Повреждено текстовое поле.'); };
      const ids = v => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x) || new Set(v).size !== v.length) throw Error('Повреждены связи записей.'); };
      const segments = v => { if (!Array.isArray(v) || v.some(p => !object(p) || !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start)) throw Error('Повреждены интервалы таймера.'); };
      const weeks = v => { if (!object(v) || Object.entries(v).some(([k, n]) => !/^\d{4}-W\d{2}$/.test(k) || !Number.isSafeInteger(n) || n < 0)) throw Error('Повреждено распределение по неделям.'); };
      const checkFields = o => {
        if (!object(o) && !Array.isArray(o)) return;
        for (const [k, v] of Object.entries(o)) {
          if (['title', 'name', 'text', 'notes', 'note', 'description', 'minimumVersion', 'reason', 'query', 'globalQuery'].includes(k) && typeof v !== 'string') throw Error('Повреждено текстовое поле.');
          if (['taskIds', 'additionalAreaIds', 'blockIds', 'tags'].includes(k) && (!Array.isArray(v) || v.some(x => typeof x !== 'string'))) throw Error('Повреждён список связей или тегов.');
          checkFields(v);
        }
      }; checkFields(s);
      for (const key of ['settingsDraft', 'onboardingDraft']) {
        const draft = s.uiState[key]; if (!draft) continue;
        if (!object(draft.settings) || ['sleep', 'work', 'commute', 'focus'].some(k => !object(draft.settings[k])) || !Array.isArray(draft.settings.work.days) || !Array.isArray(draft.settings.commute.days)) throw Error('Повреждён черновик настроек.');
        if (key === 'onboardingDraft' && (!Array.isArray(draft.areas) || !Number.isInteger(draft.step) || draft.step < 0 || draft.step > 8)) throw Error('Повреждён черновик знакомства.');
      }
      for (const key of ['effectiveFrom']) if (s.settings[key]) DateUtils.minute(s.settings[key] + 'T00:00');
      if (s.uiState.selectedDate) DateUtils.minute(s.uiState.selectedDate + 'T00:00');
      for (const key of ['workMinutes', 'breakMinutes', 'longBreakMinutes']) if (!Number.isInteger(s.settings.focus[key]) || s.settings.focus[key] < 1 || s.settings.focus[key] > 1440) throw Error('Проверь длительности таймера.');
      const timer = s.uiState.focusTimer;
      if (timer) {
        for (const k of ['workMinutes', 'breakMinutes', 'longBreakMinutes']) if (!Number.isInteger(timer[k]) || timer[k] < 1 || timer[k] > 1440) throw Error('Повреждены длительности таймера.');
        if (!Number.isInteger(timer.completedCycles) || timer.completedCycles < 0) throw Error('Повреждён счётчик циклов.');
        segments(timer.segments); date(timer.startedAt);
        for (const k of ['taskId', 'blockId', 'areaId']) if (timer[k] != null && typeof timer[k] !== 'string') throw Error('Повреждены связи таймера.');
      }
      for (const key of ['settingsDraft', 'areaDraft', 'taskDraft', 'inboxDraft', 'inboxEditDraft', 'blockDraft', 'focusDraft', 'onboardingDraft']) if (s.uiState[key] != null && !object(s.uiState[key])) throw Error('Повреждён черновик формы.');
      const unique = (list, key = 'id') => { const ids = new Set(); for (const x of list) { if (!x || typeof x[key] !== 'string' || !x[key] || ids.has(x[key])) throw Error('Повреждены идентификаторы записей.'); ids.add(x[key]); } };
      for (const k of ['tasks', 'calendarBlocks', 'brainDumpItems', 'capacityReservations', 'focusSessions', 'displacementLog']) unique(s[k]);
      unique(s.recurrenceSeries, 'seriesId'); unique(s.weekSnapshots, 'weekId');
      for (const t of s.tasks) { text(t.title, 120); text(t.notes, 2000); text(t.minimumVersion, 500); date(t.createdAt); if (t.completedAt != null) date(t.completedAt); ids(t.blockIds); TaskService.validate(t, s); if (typeof t.actualMinutesManualOverride !== 'boolean') throw Error('Повреждены связи задачи.'); }
      const block = b => { if (b.taskIds === undefined) b.taskIds = []; if (!Array.isArray(b.additionalAreaIds) || !Array.isArray(b.taskIds) || typeof b.protected !== 'boolean' || typeof b.note !== 'string') throw Error('Повреждена структура блока.'); CalendarService.validate(b, s); };
      s.calendarBlocks.forEach(block);
      for (const b of s.calendarBlocks) { ids(b.taskIds); ids(b.additionalAreaIds); if (b.createdAt != null) date(b.createdAt); if (b.updatedAt != null) date(b.updatedAt); }
      const taskIds = new Set(s.tasks.map(t => t.id)), blockIds = new Set(s.calendarBlocks.map(b => b.id)), areaIds = new Set(s.lifeAreas.map(a => a.id));
      if (s.tasks.some(t => t.blockIds.some(id => !blockIds.has(id))) || s.calendarBlocks.some(b => b.taskIds.some(id => !taskIds.has(id)))) throw Error('Связанная задача или блок не найдены.');
      if (timer && (timer.taskId && !taskIds.has(timer.taskId) || timer.blockId && !blockIds.has(timer.blockId) || timer.areaId && !areaIds.has(timer.areaId))) throw Error('Не найдена активная привязка таймера.');
      for (const b of s.calendarBlocks) for (const c of Object.values(b.timerCredits || {})) { FactService.validate(c.minutes); if (!c.weekMinutes || Object.values(c.weekMinutes).some(n => !Number.isInteger(n) || n < 0) || !Array.isArray(c.segments) || c.segments.some(p => !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start)) throw Error('Повреждён факт таймера в блоке.'); }
      for (const r of s.recurrenceSeries) { if (!['daily', 'weekly', 'custom'].includes(r.frequency) || r.interval !== 1 || !Array.isArray(r.weekdays) || r.weekdays.some(n => !Number.isInteger(n) || n < 1 || n > 7)) throw Error('Повреждены повторы.'); DateUtils.minute(r.startDate + 'T00:00'); if (r.until) DateUtils.minute(r.until + 'T00:00'); block(r.template); }
      for (const i of s.brainDumpItems) if (typeof i.text !== 'string' || !i.text.trim() || i.text.length > 2000 || !Object.hasOwn(INBOX_CATEGORIES, i.category) || typeof i.processed !== 'boolean') throw Error('Повреждены входящие.');
      for (const r of s.capacityReservations) { if (!['sleep', 'work', 'commute'].includes(r.type)) throw Error('Неизвестный резерв.'); const p = Intervals.of(r); if (p[1] <= p[0] || p[1] - p[0] > 1440) throw Error('Неверный интервал резерва.'); }
      for (const e of s.displacementLog) if (typeof e.reason !== 'string' || e.reason.length > 500 || !Number.isInteger(e.minutes) || e.minutes < 0) throw Error('Повреждён журнал вытеснения.');
      for (const f of s.focusSessions) { FactService.validate(f.actualMinutes); if (f.kind !== 'work' || !Array.isArray(f.segments) || f.segments.some(p => !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start)) throw Error('Повреждены сессии фокуса.'); }
      for (const f of s.reservationFacts || []) { if (!['manual', 'planned_as_actual'].includes(f.factStatus) || !['work', 'commute'].includes(f.type) || typeof f.reservationId !== 'string') throw Error('Неизвестный статус факта.'); DateUtils.minute(f.planStartDateTime); DateUtils.minute(f.planEndDateTime); const a = DateUtils.minute(f.actualStartDateTime), b = DateUtils.minute(f.actualEndDateTime); FactService.validate(f.actualMinutes); if (b < a || b - a !== f.actualMinutes) throw Error('Неверный факт резерва.'); }
      for (const i of s.brainDumpItems) date(i.createdAt);
      for (const f of s.focusSessions) { date(f.startedAt); date(f.endedAt); segments(f.segments); weeks(f.weekMinutes); if (f.completed !== true || !Number.isFinite(f.workedMs) || f.workedMs < 0) throw Error('Повреждён результат сессии.'); }
      for (const b of s.calendarBlocks) for (const credit of Object.values(b.timerCredits || {})) { segments(credit.segments); weeks(credit.weekMinutes); }
      for (const e of s.displacementLog) { DateUtils.minute(e.date + 'T00:00'); date(e.createdAt); if (e.seriesRule) { block(e.seriesRule.template); DateUtils.minute(e.seriesRule.startDate + 'T00:00'); if (!Array.isArray(e.seriesRule.weekdays)) throw Error('Повреждён журнал повторов.'); } }
      for (const e of s.recurrenceExceptions) { if (!['modified', 'cancelled'].includes(e.type) || !s.recurrenceSeries.some(r => r.seriesId === e.seriesId)) throw Error('Повреждены исключения серии.'); DateUtils.minute(e.occurrenceDate + 'T00:00'); }
      for (const v of s.settings.scheduleVersions || []) { DateUtils.minute(v.effectiveFrom + 'T00:00'); Validation.settings({ ...s.settings, ...v }); }
      for (const [date, energy] of Object.entries(s.dailyEnergy || {})) { DateUtils.minute(date + 'T00:00'); if (!Object.hasOwn(ENERGY_NAMES, energy)) throw Error('Неизвестная энергия дня.'); }
      const pref = s.settings.focusPreferences;
      if (pref && (['sound', 'browserNotifications', 'postureEnabled'].some(k => typeof pref[k] !== 'boolean') || !Number.isInteger(pref.postureMinutes) || pref.postureMinutes < 1 || pref.postureMinutes > 1440 || !pref.energyProfile || Object.values(pref.energyProfile).some(v => v !== '' && !Object.hasOwn(ENERGY_NAMES, v)))) throw Error('Повреждены настройки фокуса.');
      for (const snap of s.weekSnapshots) if (snap.metrics) {
        const m = snap.metrics; DateUtils.minute(m.week + 'T00:00');
        if (!Array.isArray(m.rows) || typeof m.status !== 'string' || !m.distribution || ['physical', 'free', 'waking', 'demand', 'overload', 'conflict', 'work', 'lost'].some(k => !Number.isFinite(m[k]) || m[k] < 0) || m.rows.some(r => typeof r.name !== 'string' || typeof r.status !== 'string' || !Number.isFinite(r.plan))) throw Error('Повреждён снимок аналитики.');
        if (['target', 'sleep', 'protectedCount', 'violatedCount'].some(k => !Number.isFinite(m[k]) || m[k] < 0) || ['lifePlan', 'lifeFact', 'absorption'].some(k => m[k] !== null && (!Number.isFinite(m[k]) || m[k] < 0 || m[k] > 100)) || !object(m.distribution) || Object.values(m.distribution).some(n => !Number.isFinite(n) || n < 0)) throw Error('Повреждены показатели снимка.');
        for (const row of m.rows) if (typeof row.id !== 'string' || ['primaryPlan', 'plan', 'normPlan'].some(k => !Number.isFinite(row[k]) || row[k] < 0) || ['primaryFact', 'fact', 'normFact', 'minimum', 'maximum'].some(k => row[k] !== null && (!Number.isFinite(row[k]) || row[k] < 0))) throw Error('Повреждены показатели сферы.');
      }
      // JSON остаётся данными, включая строки с угловыми скобками. Разметка создаётся через textContent.
      return s;
    },
    replace(s) {
      s = this.parse(JSON.stringify(s));
      if (Store.blocked || !Store.save()) throw Error('Сначала сохрани текущие изменения или скачай резервную копию.');
      const raw = JSON.stringify(s); Store.storage.setItem(KEY, raw); // атомарно: ошибка квоты оставляет прежнее значение и память
      clearTimeout(Store.timer); Store.state = s; Store.raw = raw; Store.revision++; Store.savedRevision = Store.revision; Store.bytes = Utils.size(raw); Store.lastError = '';
    },
    csv(rows) { return '\uFEFF' + rows.map(row => row.map(v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"').join(';')).join('\r\n'); }
  };
  const AnalyticsUI = {
    format(v) { return v == null ? 'Нет данных' : Utils.formatMinutes(v); },
    percent(v) { return v == null ? 'Недостаточно данных' : `${v.toFixed(1)}%`; },
    chart(title, content) { return el('details', { class: 'panel analytics-chart', open: true }, el('summary', {}, title), el('div', { class: 'chart-content' }, content)); },
    bars(rows, keys) {
      const max = Math.max(1, ...rows.flatMap(r => keys.map(([k]) => r[k] || 0)));
      return rows.map(r => el('div', { class: 'chart-row' }, el('strong', {}, r.name), keys.map(([k, label], i) => el('div', { class: 'bar-line' }, el('span', {}, label), el('div', { class: 'bar-track' }, el('div', { class: `bar-fill tone-${i}`, style: `width:${(r[k] || 0) / max * 100}%` })), el('span', {}, this.format(r[k]), /fact/i.test(k) && r[k] != null && r.partial ? ' · частично' : '')))));
    },
    render(main) {
      Store.change(s => AnalyticsService.sync(s));
      const period = Store.state.uiState.analyticsPeriod || 'current', current = Utils.monday(), dates = period === 'four' ? [3, 2, 1, 0].map(n => DateUtils.add(current, -7 * n)) : [DateUtils.add(current, period === 'previous' ? -7 : 0)];
      const metrics = dates.map(d => { ReservationService.ensure(Store.state, d); return AnalyticsService.snapshot(Store.state, d); }); Store.revision++; Store.save();
      const m = metrics.at(-1), selector = select('analyticsPeriod', period, [['current', 'Текущая неделя'], ['previous', 'Предыдущая неделя'], ['four', 'Последние 4 недели']]); selector.addEventListener('change', () => { Store.change(s => { s.uiState.analyticsPeriod = selector.value; }); UI.render(); });
      main.append(UI.heading('Аналитика', 'План показывает намерения. Факт — только то, что удалось зафиксировать.'), field('Период аналитики', selector));
      if (metrics.length > 1) main.append(el('p', { class: 'hint' }, 'Показатели и сферы приведены отдельно для каждой недели; графики ниже охватывают весь период.'));
      for (const x of metrics) {
        const card = (name, value) => el('div', { class: 'metric-card' }, el('span', {}, name), el('strong', {}, value));
        main.append(el('h2', {}, `${Utils.dateLabel(x.week)} — ${Utils.dateLabel(DateUtils.add(x.week, 6))}`), el('div', { class: 'analytics-key' }, card('Статус загрузки', x.status.label || x.status), card('Свободный резерв', this.format(x.free)), card('Поглощение личного времени', x.absorption == null ? 'Нет данных' : this.percent(x.absorption)), card('Жизнь вне работы', `План ${this.percent(x.lifePlan)} · факт ${this.percent(x.lifeFact)}${x.partial ? ' · частичные данные' : ''}`)), el('p', { class: 'hint' }, 'Расчёт факта использует запланированный сон и зафиксированное фактическое рабочее время. Неподтверждённая дорога не добавляется к факту.'));
        const table = el('table', {}, el('caption', {}, 'Сферы жизни · вклад и нормативы'), el('thead', {}, el('tr', {}, ['Сфера', 'План', 'Факт', 'Минимум', 'Статус по плану'].map(v => el('th', { scope: 'col' }, v)))), el('tbody', {}, x.rows.filter(r => !r.hidden || r.plan || r.fact).map(r => el('tr', {}, el('th', { scope: 'row' }, r.name), el('td', {}, this.format(r.normPlan)), el('td', {}, this.format(r.normFact), (r.normPartial ?? r.partial) && r.normFact != null ? ' · частично' : ''), el('td', {}, r.minimum == null ? 'Не задан' : this.format(r.minimum)), el('td', {}, r.status)))));
        main.append(el('section', { class: 'panel table-scroll' }, table), el('details', { class: 'panel' }, el('summary', {}, 'Показать все показатели'), el('div', { class: 'analytics-key' }, [['Физически занято · план', x.physical], ['Нераспределено', x.free], ['Бодрствование', x.waking], ['Целевой резерв', x.target], ['Спрос на ёмкость', x.demand], ['Избыточный спрос', x.overload], ['Конфликтное время', x.conflict], ['Вытеснено работой', x.lost]].map(([k, v]) => card(k, this.format(v)))), el('p', {}, `Защищённых блоков: ${x.protectedCount}. Нарушенных: ${x.violatedCount}.`), el('p', {}, `Нулевой известный вклад: ${x.rows.filter(r => r.normFact === 0 && !r.hidden).map(r => r.name).join(', ') || 'нет'}.`), el('p', {}, `Без фактических данных: ${x.rows.filter(r => r.normFact === null && !r.hidden).map(r => r.name).join(', ') || 'нет'}.`)));
      }
      const periodRows = [...new Map(metrics.flatMap(x => x.rows).map(r => [r.id, r])).values()];
      const rows = periodRows.map(r => ({ ...r, partial: metrics.some(x => x.rows.find(a => a.id === r.id)?.partial), primaryPlan: metrics.reduce((n, x) => n + (x.rows.find(a => a.id === r.id)?.primaryPlan || 0), 0), primaryFact: metrics.some(x => x.rows.find(a => a.id === r.id)?.primaryFact != null) ? metrics.reduce((n, x) => n + (x.rows.find(a => a.id === r.id)?.primaryFact || 0), 0) : null, plan: metrics.reduce((n, x) => n + (x.rows.find(a => a.id === r.id)?.plan || 0), 0), fact: metrics.some(x => x.rows.find(a => a.id === r.id)?.fact != null) ? metrics.reduce((n, x) => n + (x.rows.find(a => a.id === r.id)?.fact || 0), 0) : null }));
      const distribution = {}; metrics.forEach(x => Object.entries(x.distribution).forEach(([k, v]) => { distribution[k] = (distribution[k] || 0) + v; })); distribution.free = metrics.reduce((n, x) => n + x.free, 0);
      const colors = ['#49675a', '#78628a', '#9d6840', '#49788a', '#8b5468', '#757737', '#59689b'], names = { sleep: 'Сон', commute: 'Дорога', work: 'Работа', free: 'Свободно' }, total = metrics.length * 10080; let offset = 0;
      const slices = Object.entries(distribution).filter(([, v]) => v).map(([id, v], i) => { const start = offset; offset += v / total * 100; return { name: names[id] || rows.find(r => r.id === id)?.name || 'Без сферы', value: v, color: colors[i % colors.length], gradient: `${colors[i % colors.length]} ${start}% ${offset}%` }; });
      const pie = el('div', {}, el('div', { class: 'physical-pie', role: 'img', 'aria-label': 'Распределение всех часов выбранного периода; значения приведены в легенде', style: `background:conic-gradient(${slices.map(x => x.gradient).join(',')})` }), el('ul', {}, slices.map(x => el('li', {}, el('span', { class: 'legend-dot', style: `background:${x.color}` }), `${x.name}: ${this.format(x.value)}`))));
      const history = el('div', { class: 'analytics-charts' }, this.chart('План / факт по главным сферам', [el('p', { class: 'hint' }, 'Здесь календарные блоки. Системные резервы показаны в распределении физического времени; работа без двойного учёта — в таблице нормативов.'), ...this.bars(rows, [['primaryPlan', 'План'], ['primaryFact', 'Факт']])]), this.chart('Распределение физического времени', pie), this.chart('Вклад в сферы', [el('p', { class: 'hint' }, 'Главная и дополнительные сферы. Сумма может превышать 168 часов. Это не доли физического времени.'), ...this.bars(rows, [['plan', 'План'], ['fact', 'Факт']])]), this.chart('Поглощение личного времени', metrics.map(x => el('div', { class: 'chart-row' }, el('strong', {}, Utils.dateLabel(x.week)), el('p', {}, `${x.absorption == null ? 'Нет данных' : this.percent(x.absorption)} · ${this.format(x.lost)} вытеснено`), el('progress', { max: 100, value: x.absorption || 0, 'aria-label': `Поглощение с ${x.week}` })))), this.chart('Жизнь вне работы', metrics.map(x => el('div', { class: 'chart-row' }, el('strong', {}, Utils.dateLabel(x.week)), el('p', {}, `План ${this.percent(x.lifePlan)} · факт ${this.percent(x.lifeFact)}${x.partial ? ' · частично' : ''}`), el('progress', { max: 100, value: x.lifePlan || 0, 'aria-label': `План жизни вне работы с ${x.week}` }), x.lifeFact == null ? null : el('progress', { max: 100, value: x.lifeFact, 'aria-label': `Факт жизни вне работы с ${x.week}` })))), this.chart('История статусов загрузки', metrics.map(x => el('div', { class: `chart-row status-${x.status.key || ''}` }, el('strong', {}, Utils.dateLabel(x.week)), el('p', {}, x.status.label || x.status)))));
      main.append(history, el('section', { class: 'panel' }, el('h2', {}, 'Что видно на этой неделе'), el('ul', {}, AnalyticsService.insights(m, AnalyticsService.snapshot(Store.state, DateUtils.add(m.week, -7))).map(t => el('li', {}, t))))); Store.revision++; Store.save();
    },
    transfers(main) {
      const file = input('backupFile', '', 'file', { accept: '.json,application/json' }), error = el('p', { class: 'error', role: 'alert' });
      file.addEventListener('change', async () => { try { Store.save(); if (!file.files[0]) return; const s = TransferService.parse(await file.files[0].text()); const body = el('div', {}, el('p', {}, `Сферы: ${s.lifeAreas.length}. Задачи: ${s.tasks.length}. Блоки: ${s.calendarBlocks.length}. Входящие: ${s.brainDumpItems.length}. Снимки недель: ${s.weekSnapshots.length}.`), el('p', {}, 'После подтверждения текущие данные будут полностью заменены. Сначала можно скачать резервную копию.'), button('Скачать текущую копию', () => backup()), el('div', { class: 'actions' }, button('Отмена', () => UI.close()), button('Заменить данные', () => { try { TransferService.replace(s); UI.close(); App.show(); FocusUI.init(); } catch (e) { error.textContent = `Импорт не выполнен: ${e.message}`; UI.close(); } }, 'primary'))); UI.open('Импорт резервной копии', body); } catch (e) { error.textContent = `Импорт не выполнен: ${e.message}`; } finally { file.value = ''; } });
      main.append(el('section', { class: 'panel' }, el('h2', {}, 'Перенос и очистка данных'), field('Импортировать JSON', file), error, el('div', { class: 'actions' }, button('CSV задач', () => { Store.save(); download(TransferService.csv([['Название', 'Сфера', 'Статус', 'Оценка, мин', 'Факт, мин'], ...Store.state.tasks.map(t => [t.title, Store.state.lifeAreas.find(a => a.id === t.areaId)?.name, TASK_STATUSES[t.status], t.estimatedMinutes, t.actualMinutes])]), `life168-задачи-${Utils.localDate()}.csv`); }), button('CSV недельной аналитики', () => { Store.change(s => AnalyticsService.sync(s)); const rows = [...Store.state.weekSnapshots.map(s => s.metrics), AnalyticsService.calculate(Store.state, Utils.monday())].filter(Boolean); download(TransferService.csv([['Неделя', 'Занято, мин', 'Свободно, мин', 'Спрос, мин', 'Конфликт, мин', 'Статус', 'Поглощение, %', 'Жизнь вне работы план, %', 'Жизнь вне работы факт, %'], ...rows.map(m => [m.week, m.physical, m.free, m.demand, m.conflict, m.status.label || m.status, m.absorption, m.lifePlan, m.lifeFact])]), `life168-аналитика-${Utils.localDate()}.csv`); }), button('Удалить все данные', () => UI.resetDialog(), 'danger'))));
    }
  };
  const App = {
    init() {
      Store.onStatus = () => UI.status();
      try { Store.init(window.localStorage); } catch { Store.init({ getItem() { throw new Error('Недоступно'); } }); }
      if (!Store.blocked) Store.change(s => AnalyticsService.sync(s));
      this.show();
      if (!Store.blocked) FocusUI.init();
    },
    show() { UI.render(); if (!Store.blocked && (!Store.state.uiState.onboardingComplete || Store.state.uiState.onboardingDraft)) Wizard.start(); }
  };
  const api = { Utils, Defaults, Validation, Store, AreaService, SettingsService, DataMigrations, CURRENT_DATA_VERSION, SOFT_LIMIT, DateUtils, Intervals, ReservationService, RecurrenceService, BudgetService, ProtectionService, CalendarService, TaskService, InboxService, FactService, SearchService, FocusService, EnergyService, AnalyticsService, TransferService };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    document.querySelector('#modal').addEventListener('cancel', () => Store.save());
    document.querySelector('#modal').addEventListener('close', () => Store.save());
    document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); UI.navigate('week'); });
    window.addEventListener('pagehide', () => Store.save());
    window.addEventListener('beforeunload', () => Store.save());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) FocusUI.refresh(); });
    document.addEventListener('pointerdown', () => FocusUI.unlockAudio());
    document.addEventListener('keydown', () => FocusUI.unlockAudio());
    // Другая вкладка не должна незаметно затереть изменения текущей.
    window.addEventListener('storage', e => { if (e.key === KEY && e.newValue !== JSON.stringify(Store.state)) { Store.blocked = true; Store.lastError = 'Данные изменены в другой вкладке. Скачай текущую копию и обнови страницу перед продолжением.'; UI.status(); } });
    App.init();
  }
})();
