import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const output='/tmp/feedx-ai-capability-domains';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const findings=[];
for(const width of [1440,1040,400]){
 await page.setViewportSize({width,height:960});await page.goto('http://127.0.0.1:4177/qa/native-assistant-management/index.html');
 await page.getByRole('button',{name:'Save',exact:true}).waitFor();
 for(const section of ['Overview','AI Capabilities','Voice & Usage']){
  await page.getByRole('tab',{name:section,exact:true}).click();
  if(section==='AI Capabilities'){
   for(const owner of ['Factory','Crew','HR','Marketing'])await page.locator(`details[aria-label="${owner} domain"]`).waitFor();
   if(await page.getByRole('button',{name:'Test Finished Goods read'}).count())throw new Error('Standalone legacy controls remain');
   await page.getByRole('button',{name:'View Finished Goods details'}).click();
   await page.getByRole('region',{name:'Finished Goods details'}).getByRole('button',{name:'Test Finished Goods read'}).waitFor();
   await page.screenshot({path:`${output}/${width}-factory-detail.png`,fullPage:true});
   await page.getByRole('button',{name:'View Production SOP & QC details'}).click();
   if(await page.getByRole('button',{name:'Test Finished Goods read'}).count())throw new Error('Multiple resource details remained open');
   await page.screenshot({path:`${output}/${width}-source-detail.png`,fullPage:true});
   await page.getByRole('button',{name:'Hide Production SOP & QC details'}).click();
   await page.getByRole('button',{name:'Domain',exact:true}).click();await page.getByRole('option',{name:'Factory',exact:true}).click();
   await page.getByText('2 of 5 resources', {exact:false}).waitFor();
   await page.getByRole('button',{name:'Resource type',exact:true}).click();await page.getByRole('option',{name:'Source only',exact:true}).click();
   await page.getByText('1 of 5 resources', {exact:false}).waitFor();
   await page.getByRole('button',{name:'Connection',exact:true}).click();await page.getByRole('option',{name:'Connected',exact:true}).click();
   await page.getByText('No resources match these filters.',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Clear all'}).click();
   await page.getByRole('searchbox',{name:'Search resources'}).fill('contract');await page.getByText('1 of 5 resources',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Clear all'}).click();
   const owner=page.locator('details[aria-label="Factory domain"]');await owner.locator('summary').focus();await page.keyboard.press('Enter');
   if(await owner.getAttribute('open')!==null)throw new Error('Keyboard domain collapse failed');
   await page.keyboard.press('Enter');await page.getByRole('heading',{name:'AI Integrations',exact:true}).click();
  }
  if(section==='Voice & Usage')await page.getByText('2 of 2 sessions').waitFor();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
  if(dimensions.scroll>width+1)throw new Error(`Overflow ${width} ${section}: ${dimensions.scroll}`);
  await page.screenshot({path:`${output}/${width}-${section.replaceAll(/[^a-z]/gi,'-')}.png`,fullPage:true});
  findings.push({width,section,...dimensions});
 }
 await page.getByRole('button',{name:'Edit policy'}).click();
 await page.getByRole('spinbutton',{name:'Maximum session (seconds)'}).fill('120');
 await page.screenshot({path:`${output}/${width}-policy-edit.png`,fullPage:true});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 if(await page.getByRole('spinbutton').count())throw new Error('Cancel did not restore View mode');
 await page.getByRole('button',{name:'Status',exact:true}).click();
 await page.getByRole('option',{name:'Failed',exact:true}).click();
 await page.getByText('1 of 2 sessions').waitFor();
 await page.getByRole('button',{name:'Provider',exact:true}).click();
 await page.screenshot({path:`${output}/${width}-branded-menu.png`,fullPage:true});
 await page.keyboard.press('Escape');
 if(await page.getByRole('listbox').count())throw new Error('Escape did not dismiss menu');
 await page.getByRole('button',{name:'Clear all'}).click();await page.getByText('2 of 2 sessions').waitFor();
}
await browser.close();await writeFile(`${output}/checks.json`,JSON.stringify({findings,errors},null,2));
if(errors.length)throw new Error(errors.join('\n'));console.log(JSON.stringify({viewports:[1440,1040,400],sections:3,overflow:false,filters:'passed',escape:'passed',pageErrors:errors.length,output}));
