async page => {
  if(!page.url().startsWith('http://127.0.0.1:4186'))throw new Error('Только отдельный тестовый адрес');
  page.setDefaultTimeout(7000);await page.setViewportSize({width:1440,height:1000});
  const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ok=(x,m)=>{if(!x)throw new Error(m)};
  const btn=n=>page.getByRole('button',{name:n,exact:true});
  const st=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('life168_app')));
  const step=async(n,f)=>{await f();results.push(n)};
  await page.evaluate(()=>localStorage.removeItem('life168_app'));await page.reload();await btn('Пропустить').click();
  const dates=await page.evaluate(()=>{const d=new Date();const m=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));m.setUTCDate(m.getUTCDate()-(m.getUTCDay()+6)%7);return Array.from({length:14},(_,i)=>new Date(+m+i*86400000).toISOString().slice(0,10));});
  const current=dates[0];
  const confirm=async()=>{if(await btn('Сохранить с подтверждением').isVisible())await btn('Сохранить с подтверждением').click();};
  const add=async(title,start,end,areaName='Дочь / семья',protect=false)=>{
    await btn('+ Добавить блок').first().click();await page.getByLabel('Название блока',{exact:true}).fill(title);
    await page.getByLabel('Главная сфера',{exact:true}).selectOption({label:areaName});
    await page.getByLabel('Защищённый блок',{exact:true}).setChecked(protect);
    await page.getByLabel('Дата и время начала',{exact:true}).fill(start);await page.getByLabel('Дата и время окончания',{exact:true}).fill(end);
  };
  const open=async title=>page.locator('.calendar-event').filter({has:page.locator('strong',{hasText:title})}).first().click();
  await step('Выбор даты, предыдущая / следующая / текущая неделя',async()=>{
    await page.getByLabel('Выбрать дату и неделю').fill(current);await page.getByLabel('Выбрать дату и неделю').press('Tab');
    ok((await st()).uiState.selectedDate===current,'Не выбрана дата');
    await page.getByRole('button',{name:'Следующая неделя',exact:true}).click();ok((await st()).uiState.selectedDate===dates[7],'Следующая неделя');
    await page.getByRole('button',{name:'Предыдущая неделя',exact:true}).click();ok((await st()).uiState.selectedDate===current,'Предыдущая неделя');
    await btn('Текущая неделя').click();ok(await page.locator('[data-metric=physical]').innerText()==='101 ч','Начальный бюджет');
    await page.getByLabel('Выбрать дату и неделю').fill(current);await page.getByLabel('Выбрать дату и неделю').press('Tab');
  });
  await step('Создание защищённого блока и восстановление после reload',async()=>{
    await add('Вечер с семьёй',current+'T19:00',current+'T21:00','Дочь / семья',true);await btn('Сохранить блок').click();await confirm();
    ok((await st()).calendarBlocks[0].plannedMinutes===120,'Блок не создан');await page.reload();ok(await page.locator('.calendar-event').filter({hasText:'Вечер с семьёй'}).count()===1,'Блок не восстановился');
  });
  await step('Защищённое сокращение: отмена подтверждения и потеря 45 минут',async()=>{
    await open('Вечер с семьёй');await btn('Изменить время / перенести').click();await page.getByLabel('Дата и время окончания',{exact:true}).fill(current+'T20:15');await page.getByLabel('Изменение связано с рабочим обязательством').check();await btn('Сохранить блок').click();
    ok(await page.getByRole('heading',{name:'Подтвердить изменение'}).isVisible(),'Нет подтверждения');ok((await st()).displacementLog.length===0,'Записано до подтверждения');
    await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();ok(await page.getByLabel('Дата и время окончания',{exact:true}).inputValue()===current+'T20:15','Потерян ввод при отмене');
    await btn('Сохранить блок').click();await confirm();ok((await st()).displacementLog[0].minutes===45,'Не 45 минут');
  });
  await step('Компенсация конкретным новым блоком',async()=>{
    await add('Вернуть семейное время',dates[1]+'T19:00',dates[1]+'T20:00','Дочь / семья',true);await btn('Сохранить блок').click();await confirm();
    await btn('Учесть восстановление').click();await page.getByLabel('Восстановлено минут',{exact:true}).fill('45');await btn('Сохранить восстановление').click();
    ok((await st()).displacementLog[0].resolvedMinutes===45,'Компенсация не записана');
  });
  await step('Рабочая детализация и независимый конфликт',async()=>{
    const before=await page.locator('[data-metric=physical]').innerText();await add('Подготовить отчёт',current+'T10:00',current+'T11:00','Работа');await btn('Сохранить блок').click();await confirm();
    ok(await page.locator('[data-metric=physical]').innerText()===before,'Работа учтена дважды');
    await add('Личное дело',current+'T10:00',current+'T11:00');await btn('Сохранить блок').click();ok((await page.getByRole('dialog').innerText()).includes('конфликт'),'Нет предупреждения');await confirm();ok(await page.locator('[data-metric=conflict]').innerText()==='1 ч','Неверный конфликт');
  });
  await step('Ночной блок, неверная длительность и полный диапазон',async()=>{
    await add('Поздняя прогулка',dates[5]+'T23:30',dates[5]+'T23:00');await btn('Сохранить блок').click();ok((await page.locator('dialog .error').innerText()).includes('Длительность'),'Принята отрицательная длительность');
    await page.getByLabel('Дата и время окончания',{exact:true}).fill(dates[6]+'T00:30');await btn('Сохранить блок').click();await confirm();
    await page.getByRole('button',{name:'Есть события вне видимого времени · Показать 00:00–24:00',exact:true}).click();
    ok(await page.locator('.calendar-event').filter({hasText:'Поздняя прогулка'}).count()===2,'Нет двух частей ночного блока');
    ok((await st()).calendarBlocks.find(b=>b.title==='Поздняя прогулка').plannedMinutes===60,'Ночная длительность');
  });
  await step('Серия по выбранным дням и одиночное исключение',async()=>{
    await add('Прогулка по расписанию',current+'T18:00',current+'T18:30','Собаки / прогулки');
    await page.getByLabel('Повторение',{exact:true}).selectOption('custom');await page.locator('[name=repeatDays][value="3"]').check();await page.locator('[name=repeatDays][value="5"]').check();await btn('Сохранить блок').click();await confirm();
    ok((await st()).recurrenceSeries.length===1,'Нет серии');ok(await page.locator('.calendar-event').filter({hasText:'Прогулка по расписанию'}).count()===3,'Неверные дни серии');
    await open('Прогулка по расписанию');await btn('Редактировать блок').click();await page.getByLabel('Название блока',{exact:true}).fill('Исключение прогулки');await btn('Сохранить блок').click();await confirm();
    ok((await st()).recurrenceExceptions.length===1,'Нет исключения');ok(await page.locator('.calendar-event').filter({hasText:'Прогулка по расписанию'}).count()===2,'Затронуты другие повторы');
  });
  await step('Удаление серии с отдельным подтверждением',async()=>{
    await open('Прогулка по расписанию');await btn('Удалить блок').click();await page.getByLabel('Что удалить',{exact:true}).selectOption('all');await btn('Продолжить удаление').click();
    ok(await btn('Удалить всю серию').isVisible(),'Нет подтверждения серии');await btn('Удалить всю серию').click();ok(await page.locator('.calendar-event').filter({hasText:'Прогулка по расписанию'}).count()===0,'Серия осталась');
  });
  await step('Статусы, копирование, перенос и удаление обычного блока',async()=>{
    await open('Личное дело');await btn('Пропустить').click();await confirm();ok((await st()).calendarBlocks.find(b=>b.title==='Личное дело').status==='skipped','Статус не изменён');
    await open('Подготовить отчёт');await btn('Копировать').click();await page.getByLabel('Название блока',{exact:true}).fill('Копия отчёта');await page.getByLabel('Дата и время начала',{exact:true}).fill(dates[1]+'T12:00');await page.getByLabel('Дата и время окончания',{exact:true}).fill(dates[1]+'T13:00');await btn('Сохранить блок').click();await confirm();
    await open('Копия отчёта');await btn('Удалить блок').click();await btn('Продолжить удаление').click();if(await btn('Подтвердить удаление').isVisible())await btn('Подтвердить удаление').click();ok(!(await st()).calendarBlocks.some(b=>b.title==='Копия отчёта'),'Копия не удалена');
  });
  await step('Черновик блока и безопасная заметка',async()=>{
    await add('Черновик календаря',current+'T18:00',current+'T18:30');await page.getByLabel('Заметка',{exact:true}).fill('<img src=x onerror=alert(1)>');await page.keyboard.press('Escape');await page.reload();await btn('Продолжить блок').click();ok(await page.getByLabel('Название блока',{exact:true}).inputValue()==='Черновик календаря','Черновик утрачен');await btn('Сохранить блок').click();await confirm();await open('Черновик календаря');ok(await page.locator('dialog img').count()===0,'Заметка исполнилась');await btn('Закрыть').click();
  });
  await step('Бюджет, мобильный выбор дня и отсутствие переполнения',async()=>{
    await page.getByRole('navigation').getByRole('button',{name:'168 часов',exact:true}).click();ok(await page.getByRole('heading',{name:'168 часов',exact:true}).isVisible(),'Нет бюджета');ok(await page.getByRole('table').count()===1,'Нет вкладов');
    await page.getByRole('navigation').getByRole('button',{name:'Моя неделя',exact:true}).click();await page.setViewportSize({width:390,height:844});
    const weekdays=page.locator('.mobile-days button');await weekdays.nth(2).click();ok((await st()).uiState.selectedDate===dates[2],'День не переключается');ok(await page.locator('.calendar-day:visible').count()===1,'Не один день на телефоне');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Переполнение экрана');
  });
  ok(errors.length===0,errors.join('\n'));return {passed:results.length,results,pageErrors:errors};
}
