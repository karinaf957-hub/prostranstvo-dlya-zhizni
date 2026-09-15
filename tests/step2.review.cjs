const {chromium}=require('playwright');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:4186');await page.getByRole('button',{name:'Пропустить',exact:true}).click();
  const add=page.getByRole('button',{name:'+ Добавить блок',exact:true}).first();await add.focus();await page.keyboard.press('Enter');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});if(await page.locator('dialog').evaluate(e=>e.getBoundingClientRect().width)>width)throw Error('Wide dialog');await page.keyboard.press('Tab');if(!await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)))throw Error('Focus outside');}
  await page.getByLabel('Название блока',{exact:true}).fill('Время с семьёй');await page.getByRole('button',{name:'Сохранить блок',exact:true}).click();
  const confirm=page.getByRole('button',{name:'Сохранить с подтверждением',exact:true});if(await confirm.isVisible())await confirm.click();
  for(const width of [1440,390])for(const section of ['Моя неделя','168 часов']){
   await page.setViewportSize({width,height:1000});await page.getByRole('navigation').getByRole('button',{name:section,exact:true}).click();await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(__dirname,`step2-${width}-${section==='Моя неделя'?'calendar':'budget'}.png`),animations:'disabled'});
  }
  const second=await context.newPage();await second.goto('http://127.0.0.1:4186');await second.getByRole('navigation').getByRole('button',{name:'Настройки',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#storage-warning')?.textContent.includes('другой вкладке'));
  await second.close();await page.reload();if(await page.locator('#storage-warning').isVisible())throw Error('Blocked after reload');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Keyboard, dialog 1440/390/320, real cross-tab protection and reload: passed; browser errors: 0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
