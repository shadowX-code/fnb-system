import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const output='/tmp/feedx-ai-capabilities';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const findings=[];
for(const width of [1440,1040,400]){
 await page.setViewportSize({width,height:960});await page.goto('http://127.0.0.1:4177/qa/native-assistant-management/index.html');
 await page.getByRole('button',{name:'Save',exact:true}).waitFor();
 for(const section of ['Overview','AI Capabilities','Voice & Usage']){
  await page.getByRole('tab',{name:section,exact:true}).click();
  if(section==='AI Capabilities'){
   await page.getByRole('region',{name:'Finished Goods READ'}).getByRole('button',{name:'Test Finished Goods read'}).waitFor();
   const module=page.locator('details[aria-label="SOP Library capabilities"]');
   await module.locator('summary').click();
   if(await module.getAttribute('open')===null)throw new Error('Module details did not expand');
   await page.screenshot({path:`${output}/${width}-source-details.png`,fullPage:true});
   await module.locator('summary').focus();await page.keyboard.press('Enter');
   if(await module.getAttribute('open')!==null)throw new Error('Keyboard module collapse failed');
   await page.getByRole('heading',{name:'AI Integrations',exact:true}).click();
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
