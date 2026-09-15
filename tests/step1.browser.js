async (page) => {
  if (!page.url().startsWith('http://127.0.0.1:4186')) throw new Error('Тест разрешён только на отдельном тестовом адресе.');
  page.setDefaultTimeout(7000);
  const results = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('life168_app')));
  const button = name => page.getByRole('button', { name, exact: true });
  const step = async (name, run) => { await run(); results.push(name); };
  await page.evaluate(() => localStorage.removeItem('life168_app'));
  await page.reload();
  await step('Первый запуск, пропуск и восемь разделов', async () => {
    assert(await page.getByRole('heading', {name:'Добро пожаловать'}).isVisible(), 'Нет знакомства');
    await button('Пропустить').click();
    assert((await state()).uiState.onboardingComplete, 'Пропуск не сохранён');
    for (const name of ['Моя неделя','168 часов','Сферы жизни','Входящие','Задачи','Фокус','Аналитика','Настройки']) {
      await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
      assert(await page.getByRole('heading',{name,exact:true,level:1}).isVisible(), 'Навигация: '+name);
    }
  });
  await step('Черновик настроек, перезагрузка и применение', async () => {
    await page.getByLabel('Как тебя зовут').fill('Проверка'); await page.getByLabel('Резерв бодрствования, %').focus();
    assert((await state()).uiState.settingsDraft.name === 'Проверка','Нет черновика');
    await page.reload(); assert(await page.getByLabel('Как тебя зовут').inputValue() === 'Проверка','Черновик утрачен');
    await page.getByLabel('Учитывать дорогу на работу').check();
    await page.reload(); assert(await page.getByLabel('Учитывать дорогу на работу').isChecked(),'Переключатель не сохранён');
    assert(await page.locator('input[name=commuteDays]:checked').count() === 5,'Дни дороги потеряны');
    await button('Сохранить настройки').click();
    assert((await state()).profile.name === 'Проверка','Имя не применилось');
    assert((await state()).settings.commute.enabled,'Дорога не применена');
    assert(!(await state()).uiState.settingsDraft,'Черновик не снят');
  });
  await step('Повторное знакомство, все шаги и ночной сон', async () => {
    await button('Пройти знакомство заново').click(); await button('Начать настройку →').click();
    await page.getByLabel('Творчество',{exact:true}).uncheck(); await button('Далее →').click();
    await page.getByRole('dialog').getByLabel('Начало сна в будни').fill('23:00');
    await page.reload(); assert(await page.getByRole('dialog').getByLabel('Начало сна в будни').inputValue() === '23:00','Потерян шаг знакомства');
    await button('Далее →').click(); await button('Далее →').click(); await button('Далее →').click();
    await page.getByLabel('Работа: минимум',{exact:true}).fill('45');
    await page.getByLabel('Работа: комфорт',{exact:true}).fill('40');
    await button('Далее →').click(); assert(await page.locator('dialog .error').innerText() !== '', 'Пропущены неверные нормативы');
    await page.getByLabel('Работа: минимум',{exact:true}).fill('35');
    assert(await page.locator('dialog [data-total=minimumHours] strong').innerText() === '35 ч','Сумма минимумов неверна');
    await page.getByLabel('Работа: максимум',{exact:true}).fill('170');
    assert((await page.locator('dialog [data-total=maximumHours]').innerText()).includes('Выше 168 ч на 2 ч'),'Нет превышения суммы');
    await page.getByLabel('Работа: максимум',{exact:true}).fill('45');
    await button('Далее →').click(); await button('Далее →').click();
    await page.getByRole('dialog').getByLabel('Режим по умолчанию').selectOption('25/5'); await button('Далее →').click();
    await button('Открыть мою неделю').click();
    const s = await state(); assert(s.settings.focus.workMinutes === 25 && s.settings.focus.breakMinutes === 5,'Режим не применился');
    assert(s.lifeAreas.find(a=>a.name==='Творчество').hidden,'Выбор сфер не применён');
    assert(s.settings.sleep.weekdayStart==='23:00','Сон не применён');
  });
  await step('Создание сферы, нормативы и безопасный текст', async () => {
    await page.getByRole('navigation').getByRole('button',{name:'Сферы жизни',exact:true}).click();
    await button('+ Добавить сферу').click();
    await page.getByLabel('Название сферы',{exact:true}).fill('<img src=x onerror=alert(1)>');
    await page.getByLabel('Минимум, ч / неделю',{exact:true}).fill('4');
    await page.getByLabel('Комфорт, ч / неделю',{exact:true}).fill('2');
    await button('Сохранить').click(); assert(await page.locator('dialog .error').innerText() !== '', 'Некорректный минимум принят');
    await page.getByLabel('Комфорт, ч / неделю',{exact:true}).fill('6');
    await page.getByLabel('Максимум, ч / неделю',{exact:true}).fill('8');
    await page.getByLabel('Описание',{exact:true}).fill('я'.repeat(400));
    assert(await page.locator('.counter').isVisible(),'Нет счётчика');
    await button('Сохранить').click();
    assert(await page.locator('article').filter({hasText:'<img src=x onerror=alert(1)>'}).count()===1,'Нет безопасного текста');
    assert(await page.locator('main img').count()===0,'HTML был интерпретирован');
  });
  await step('Редактирование, скрытие, восстановление, порядок и Escape', async () => {
    const card = page.locator('article').filter({hasText:'<img src=x onerror=alert(1)>'});
    await card.getByRole('button',{name:'Изменить',exact:true}).click();
    await page.getByLabel('Название сферы',{exact:true}).fill('Тестовая сфера');
    await page.getByLabel('Скрыть из активного списка').check(); await button('Сохранить').click();
    assert(await page.locator('article').filter({hasText:'Тестовая сфера'}).count()===0,'Сфера не скрыта');
    await page.getByLabel('Показать скрытые').check();
    await page.locator('article').filter({hasText:'Тестовая сфера'}).getByRole('button',{name:'Изменить',exact:true}).click();
    await page.getByLabel('Скрыть из активного списка').uncheck(); await page.getByLabel('Значок').selectOption('star'); await button('Сохранить').click();
    const before=(await state()).lifeAreas.find(a=>a.name==='Тестовая сфера').order;
    await page.getByRole('button',{name:'Поднять Тестовая сфера',exact:true}).click();
    assert((await state()).lifeAreas.find(a=>a.name==='Тестовая сфера').order < before,'Порядок не изменён');
    await page.locator('article').filter({hasText:'Тестовая сфера'}).getByRole('button',{name:'Изменить',exact:true}).click();
    await page.getByLabel('Название сферы',{exact:true}).fill('Черновик сферы'); await page.keyboard.press('Escape');
    assert(!await page.locator('dialog').isVisible(),'Escape не закрыл окно');
    await page.reload(); await button('Продолжить редактирование').click();
    assert(await page.getByLabel('Название сферы',{exact:true}).inputValue()==='Черновик сферы','Черновик сферы утрачен');
    await button('Отменить изменения').click();
  });
  await step('Удаление с переносом связей и запрет удаления системной сферы', async () => {
    await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('life168_app')); const a=s.lifeAreas.find(a=>a.name==='Тестовая сфера'); s.tasks.push({id:'test-task',areaId:a.id,title:'Проверка связи',blockIds:[],importance:1,urgency:1,leverage:1,energyRequired:'medium',estimatedMinutes:null,actualMinutes:null,actualMinutesManualOverride:false,deadline:null,status:'inbox',minimumVersion:'',notes:'',tags:[],createdAt:new Date().toISOString(),completedAt:null});s.calendarBlocks.push({id:'test-block',title:'Проверка связи',startDateTime:'2026-09-15T19:00',endDateTime:'2026-09-15T20:00',plannedMinutes:60,primaryAreaId:a.id,additionalAreaIds:[],taskIds:[],protected:false,status:'planned',energyRequired:'medium',note:'',actualMinutes:null});localStorage.setItem('life168_app',JSON.stringify(s)); });
    await page.reload();
    await page.locator('article').filter({hasText:'Тестовая сфера'}).getByRole('button',{name:'Изменить',exact:true}).click();
    await button('Удалить сферу').click(); await button('Отмена').click(); assert(await page.getByLabel('Название сферы',{exact:true}).inputValue()==='Тестовая сфера','Отмена не вернула форму');
    await button('Удалить сферу').click(); await button('Удалить сферу').click();
    const s=await state(),target=s.lifeAreas.find(a=>a.systemType==='uncategorized').id;
    assert(s.tasks[0].areaId===target && s.calendarBlocks[0].primaryAreaId===target,'Связи утрачены');
    await page.locator('article').filter({has:page.getByRole('heading',{name:'Работа',exact:true})}).getByRole('button',{name:'Изменить',exact:true}).click();
    assert(await button('Удалить сферу').count()===0,'Системную сферу можно удалить'); await page.keyboard.press('Escape');
  });
  await step('Клавиатура: Enter сохраняет форму',async()=>{
    await button('+ Добавить сферу').click();await page.getByLabel('Название сферы',{exact:true}).fill('Через клавиатуру');await page.getByLabel('Название сферы',{exact:true}).press('Enter');
    assert((await state()).lifeAreas.some(a=>a.name==='Через клавиатуру'),'Enter не сохраняет');
  });
  assert(errors.length===0,errors.join('\n'));
  return {passed:results.length,results,pageErrors:errors};
}
