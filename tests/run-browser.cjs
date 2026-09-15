// NODE_PATH points to an existing Playwright installation; no runtime app dependency.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({channel: process.argv[2] || 'chrome', headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4186');
    for (const file of ['step1.browser.js', 'step1.storage.browser.js', 'step2.browser.js']) {
      const run = eval('(' + fs.readFileSync(path.join(__dirname,file),'utf8') + ')');
      try { console.log(file, JSON.stringify(await run(page))); }
      catch(error) { console.log(await page.evaluate(()=>({title:document.title,warning:document.querySelector('#storage-warning')?.textContent,bytes:localStorage.getItem('life168_app')?.length,main:document.querySelector('main')?.textContent.slice(0,200)}))); throw error; }
    }
    for (const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      for(const section of ['Моя неделя','168 часов']) {
        await page.getByRole('navigation').getByRole('button',{name:section,exact:true}).click();
        if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw new Error('Overflow '+section+' '+width);
        if(width===1440||width===390)await page.screenshot({path:path.join(__dirname,`step2-${width}-${section==='Моя неделя'?'calendar':'budget'}.png`)});
      }
    }
    console.log('Responsive: 1440,1024,768,390,320 OK');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
