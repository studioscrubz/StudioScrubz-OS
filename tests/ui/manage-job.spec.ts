import { test, expect } from '@playwright/test';
declare global { interface Window { fixture: { calls: Array<{name:string;args:unknown[]}> } } }

test('all sections toggle, preserve edits, and expose existing save handlers without overflow',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('summary').filter({hasText:'Schedule'})).toContainText('Oct 27');
 await expect(page.locator('summary').filter({hasText:'Assigned Crew'})).toContainText('Crystal Garcia (Lead)');
 await expect(page.getByRole('button',{name:'ON MY WAY',exact:true,includeHidden:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'START JOB',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('overview.png')});
 for(const title of ['Service & property','Schedule','Assigned Crew','Job Notes','Finished Photos','Job-site GPS','Mileage','Job Time','Google Calendar']){
   const summary=page.locator('summary').filter({hasText:title}).first();
   await summary.click();await expect(summary.locator('..')).toHaveAttribute('open','');
   await summary.click();await expect(summary.locator('..')).not.toHaveAttribute('open');
 }
 const notes=page.locator('summary').filter({hasText:'Job Notes'});await notes.focus();await notes.press('Enter');await expect(notes.locator('..')).toHaveAttribute('open','');await notes.press('Space');await expect(notes.locator('..')).not.toHaveAttribute('open');
 const schedule=page.locator('summary').filter({hasText:'Schedule'}).first();await schedule.click();
 await page.getByLabel('Scheduled Date').fill('2026-11-02');
 await schedule.click();await schedule.click();await expect(page.getByLabel('Scheduled Date')).toHaveValue('2026-11-02');
 await page.getByRole('button',{name:'Save Schedule',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.fixture.calls.some(c=>c.name==='scheduleJob'&&c.args[1]==='2026-11-02'))).toBe(true);
 await schedule.click();await page.locator('summary').filter({hasText:'Assigned Crew'}).click();
 await page.getByLabel('Worker Target').selectOption('individual');await page.getByLabel('Individual Tech',{exact:true}).selectOption('lead');
 await page.getByRole('button',{name:'Save Assignment',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.fixture.calls.some(c=>c.name==='assignJobWorker'&&(c.args[1] as {kind:string}).kind==='individual'))).toBe(true);
 await expect(page.locator('summary').filter({hasText:'Mileage'})).toContainText('No mileage recorded');
 await expect(page.locator('summary').filter({hasText:'Job Time'})).toContainText('Not Started');
 await page.locator('summary').filter({hasText:'Google Calendar'}).click();await page.getByRole('button',{name:'Sync Now / Retry'}).click();
 await expect(page.locator('summary').filter({hasText:'Google Calendar'})).toContainText('Synced');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('persisted finished-photo counts update on upload and deletion; missing photos block End Job',async({page})=>{
 await page.goto('/?active=1');
 const summary=page.locator('summary').filter({hasText:'Finished Photos'});
 await expect(summary).toContainText('0 uploaded · Required');
 await expect(page.getByRole('button',{name:'END JOB',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Add Finished Photos — required before END JOB'}).click();
 await expect(summary.locator('..')).toHaveAttribute('open','');
 await page.locator('input[type=file]').last().setInputFiles({name:'finished.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:/Save Finished \/ Job Photos/}).click();
 await expect(summary).toContainText('1 uploaded · Requirement met');
 await expect(page.getByRole('button',{name:'END JOB',exact:true})).toBeEnabled();
 await page.getByLabel('Customer Visible',{exact:true}).check();
 await expect(page.getByLabel('Customer Visible',{exact:true})).toBeChecked();
 page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete photo',exact:true}).click();
 await expect(summary).toContainText('0 uploaded · Required');
 await expect(page.getByRole('button',{name:'END JOB',exact:true})).toBeDisabled();
 await expect(page.locator('summary').filter({hasText:'Job Time'})).toContainText('Running · 01:');
});

test('GPS summary tracks setup, exceptions and verified lead arrival',async({page})=>{
 await page.goto('/');const summary=page.locator('summary').filter({hasText:'Job-site GPS'});
 await expect(summary).toContainText('Setup Required');await summary.click();
 await page.getByText('Manager exception (not GPS verified)',{exact:true}).click();
 await page.getByLabel('Assigned employee',{exact:true}).selectOption('lead');await page.getByLabel('Reason for exception').fill('GPS unavailable during isolated UI test');
 await page.getByRole('button',{name:'Record exception',exact:true}).click();await expect(summary).toContainText('Setup Required');
 page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Set property GPS from my current location'}).click();
 await expect(summary).toContainText('Awaiting Verification');await page.getByRole('button',{name:'Verify my arrival using GPS'}).click();
 await expect(summary).toContainText('Verified');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('read-only users keep summaries without scheduling or assignment inputs',async({page})=>{
 await page.goto('/?readonly=1');
 await page.locator('summary').filter({hasText:'Schedule'}).click();
 await expect(page.getByLabel('Scheduled Date')).toHaveCount(0);
 await page.locator('summary').filter({hasText:'Assigned Crew'}).click();
 await expect(page.getByLabel('Worker Target')).toHaveCount(0);
 await expect(page.getByText('Assigned Team:',{exact:false}).locator('..')).toContainText('Kris Greer');
});
