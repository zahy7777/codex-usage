import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

let state, home, proc, url, binaryDir, binary, rolloutPath;
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const usage=(input,output,total,cached=0)=>({input_tokens:input,cached_input_tokens:cached,output_tokens:output,total_tokens:total});
const line=(type,payload)=>({timestamp:'2026-09-28T00:00:00Z',type,payload});

test.beforeAll(async()=>{
 binary=process.env.CODEX_USAGE_BIN;
 if(!binary){
  binaryDir=await mkdtemp(path.join(tmpdir(),'ledger-bin-'));
  binary=path.join(binaryDir,process.platform==='win32'?'codex-usage.exe':'codex-usage');
  await new Promise((resolve,reject)=>{const p=spawn(process.env.GO_BINARY||'go',['build','-o',binary,'./cmd/codex-usage'],{cwd:repoRoot,stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`go build exit ${code}`)))});
 }
 state=await mkdtemp(path.join(tmpdir(),'ledger-state-'));
 home=await mkdtemp(path.join(tmpdir(),'ledger-home-'));
 const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 url=`http://127.0.0.1:${port}`;
 await writeFile(path.join(state,'config.json'),JSON.stringify({listen_address:'127.0.0.1',port,scan_interval_seconds:600}));
 const dir=path.join(home,'sessions','2026','09','28');await mkdir(dir,{recursive:true});
 const rows=[
  line('session_meta',{id:'ledger-e2e',cwd:'C:\\ledger'}),
  line('turn_context',{turn_id:'new-turn',model:'gpt-6-sol'}),
  line('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'question <script>bad()</script>'}]}),
  line('response_item',{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'first answer'}],internal_chat_message_metadata_passthrough:{turn_id:'new-turn'}}),
  line('response_item',{type:'custom_tool_call',name:'exec',call_id:'call-one',arguments:'{"cmd":"hello"}'}),
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-one',usage:{...usage(8,2,10,3),cache_write_input_tokens:1,reasoning_output_tokens:1},turn_token_usage:{...usage(8,2,10,3),cache_write_input_tokens:1,reasoning_output_tokens:1}}),
  line('response_item',{type:'custom_tool_call_output',call_id:'call-one',output:'tool result'}),
  line('turn_context',{turn_id:'new-turn',model:'gpt-6-luna'}),
  line('response_item',{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:'second answer'}],internal_chat_message_metadata_passthrough:{turn_id:'new-turn'}}),
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-two',usage:usage(12,3,15,6),turn_token_usage:{...usage(20,5,25,9),cache_write_input_tokens:1,reasoning_output_tokens:1}}),
  line('turn_context',{turn_id:'old-turn',model:'gpt-5.4'}),
  line('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'old question'}]}),
  ...Array.from({length:105},(_,index)=>line('response_item',{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:index===0?'long message '.repeat(100):`legacy message ${index}`}]})),
  line('event_msg',{type:'token_count',info:{total_token_usage:usage(4,1,5),last_token_usage:usage(4,1,5)}})
 ];
 rolloutPath=path.join(dir,'rollout-ledger-e2e.jsonl');
 await writeFile(rolloutPath,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 proc=spawn(path.resolve(binary),['serve'],{env:{...process.env,CODEX_USAGE_HOME:state,CODEX_HOME:home},stdio:'ignore',windowsHide:true});
 for(let n=0;n<100;n++){try{const r=await fetch(`${url}/api/v1/ledger?thread_id=ledger-e2e`);if(r.ok && (await r.json()).turns.length>=2)return}catch{}await new Promise(r=>setTimeout(r,100))}
 throw new Error('ledger server did not scan fixture');
});
test.afterAll(async()=>{proc?.kill();await new Promise(r=>setTimeout(r,300));if(state)await rm(state,{recursive:true,force:true,maxRetries:5,retryDelay:100});if(home)await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});if(binaryDir)await rm(binaryDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})});

test('thread, turn and calls match deduplicated usage; text stays escaped',async({page})=>{
 const data=await (await fetch(`${url}/api/v1/ledger?thread_id=ledger-e2e&turn_id=new-turn`)).json();
 expect(data.usage.total).toBe(30);
 const turn=data.turns.find(x=>x.id==='new-turn');
 expect(turn.usage.total).toBe(25);
 expect(turn.calls.map(x=>x.usage.total)).toEqual([10,15]);
 expect(turn.calls[0].usage.cache_write_input).toBe(1);
 expect(turn.calls[0].usage.reasoning_output).toBe(1);
 expect(turn.codex_credits.credits).toBeTruthy();
 expect(turn.api_equivalent.usd).toBeTruthy();
 expect(new Set(turn.models)).toEqual(new Set(['gpt-6-sol','gpt-6-luna']));
 expect(turn.messages.some(x=>x.kind==='tool_result'&&x.text==='tool result')).toBe(true);
 expect(turn.messages.find(x=>x.kind==='assistant_commentary').response_id).toBe('response-one');
 expect(turn.messages.find(x=>x.kind==='tool_result').response_id).toBe('response-one');
 expect(turn.messages.find(x=>x.kind==='user').response_id).toBeUndefined();
 expect(turn.calls.every(x=>!('messages' in x))).toBe(true);
 expect(data.turns.find(x=>x.id==='old-turn').calls).toEqual([]);
 await page.goto(`${url}/?lang=zh-CN#details`);
 const scriptCount=await page.locator('script').count();
 const row=page.locator('[data-session-id="ledger-e2e"]');
 await expect(row).toBeVisible();
 await expect(row.locator('a[href="codex://threads/ledger-e2e"]')).toBeVisible();
 await expect(row.getByRole('link',{name:'在 Codex 打开'})).toBeVisible();
 await row.locator('[data-ledger-thread]').click();
 const dialog=page.locator('#ledgerDialog');
 await expect(dialog).toBeVisible();
 expect((await dialog.boundingBox()).width).toBeGreaterThan(1000);
 expect(await dialog.evaluate(x=>x.scrollWidth<=x.clientWidth)).toBe(true);
 await expect(dialog.locator('.ledger-turn')).toHaveCount(2);
 await expect(dialog.locator('.ledger-segment')).toHaveCount(12);
 const first=dialog.locator('[data-ledger-turn-id="new-turn"]');
 const firstIndex=await first.getAttribute('data-ledger-turn-index');
 await first.locator('[data-ledger-expand]').click();
 await expect(first.locator('.ledger-call')).toHaveCount(2);
 await expect(first.locator('[data-level="call"][data-call-index="0"] .ledger-segment')).toHaveCount(4);
 await expect(first.locator('.ledger-call').first().locator('.ledger-numbers')).toContainText('其中缓存写入1');
 await expect(first.locator('.ledger-user')).toContainText('question <script>bad()</script>');
 await expect(first.locator('.ledger-user')).toContainText('所属轮次用量');
 await first.locator(`[data-ledger-call-expand="${firstIndex}:0"]`).click();
 await expect(first.locator(`[data-ledger-call-messages="${firstIndex}:0"]`)).toContainText('first answer');
 await expect(first.locator(`[data-ledger-call-messages="${firstIndex}:0"]`)).toContainText('tool result');
 await expect(first.locator('.ledger-tag-tool_call')).toContainText('工具调用');
 await expect(first.locator('.ledger-tag-tool_result')).toContainText('工具结果');
 await expect(first.locator('.ledger-message')).toHaveCount(5);
 const reservedHeight=await dialog.locator('#ledgerProjectionContext').evaluate(x=>x.getBoundingClientRect().height);
 await first.locator('[data-level="call"][data-call-index="0"]').hover();
 await expect(first.locator('[data-level="turn"]')).toHaveClass(/has-projection/);
 await expect(dialog.locator('[data-ledger-bar][data-level="chat"]')).toHaveClass(/has-projection/);
 await expect(dialog.locator('#ledgerProjectionContext')).toBeVisible();
 expect(await dialog.locator('#ledgerProjectionContext').evaluate(x=>x.getBoundingClientRect().height)).toBeCloseTo(reservedHeight,0);
 const cachedProjection=await first.locator('[data-level="turn"] [data-part="cached"] .ledger-projection').evaluate(x=>Number.parseFloat(x.style.width));
 expect(cachedProjection).toBeCloseTo(100/3,3);
 await first.locator('[data-level="turn"]').hover();
 await expect(first.locator('[data-level="call"][data-call-index="0"]')).toHaveClass(/is-contributor/);
 await expect(first.locator('[data-level="turn"]')).not.toHaveClass(/has-projection/);
 await first.locator('[data-level="call"][data-call-index="0"]').focus();
 await expect(first.locator('[data-level="turn"]')).toHaveClass(/has-projection/);
 const parts=await dialog.locator('[data-ledger-bar][data-level="chat"] .ledger-segment').evaluateAll(items=>items.map(x=>Number.parseFloat(x.style.width)));
 expect(parts.reduce((a,b)=>a+b,0)).toBeCloseTo(100,3);
 await dialog.locator('[data-close]').click();
 await expect(dialog).toBeHidden();
 await expect(row.locator('[data-ledger-thread]')).toBeFocused();
 expect(await page.locator('script').count()).toBe(scriptCount);
 await page.locator('.primary-nav').getByRole('tab',{name:'概览'}).click();
 await page.locator('#pricingButton').click();
 await expect(page.locator('#creditCatalog')).toContainText('gpt-6-sol');
 await page.locator('#newCreditModel').fill('gpt-6-sol');
 await page.locator('#addCreditRate').click();
 const creditCard=page.locator('[data-credit-model="gpt-6-sol"]');
 await creditCard.locator('[data-credit="effective_from"]').fill('2026-01-01');
 await creditCard.locator('[data-credit="input"]').fill('100');
 await creditCard.locator('[data-credit="cached_input"]').fill('10');
 await creditCard.locator('[data-credit="output"]').fill('500');
 await page.locator('#savePricing').click();
 await expect.poll(async()=>{const r=await fetch(`${url}/api/v1/pricing/credits`);return (await r.json()).overrides?.['gpt-6-sol']?.[0]?.input}).toBe('100');
 await appendFile(rolloutPath,[
  line('turn_context',{turn_id:'new-turn',model:'gpt-6-luna'}),
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-three',usage:usage(8,2,10,4),turn_token_usage:{...usage(28,7,35,13),cache_write_input_tokens:1,reasoning_output_tokens:1}})
 ].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await new Promise((resolve,reject)=>{const hook=spawn(path.resolve(binary),['hook-stop','--state-dir',state],{env:{...process.env,CODEX_USAGE_HOME:''},stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';hook.stdout.on('data',b=>output+=b);hook.stdin.end(JSON.stringify({session_id:'ledger-e2e',turn_id:'new-turn'}));hook.on('error',reject);hook.on('exit',code=>code===0&&output.trim()==='{}'?resolve():reject(new Error(`hook exit ${code}: ${output}`)))});
 await expect.poll(async()=>{const r=await fetch(`${url}/api/v1/ledger?thread_id=ledger-e2e`);return (await r.json()).usage.total}).toBe(40);
});

test('paged messages are unique, long content expands, and selection works without hover',async({page})=>{
 await page.goto(`${url}/?lang=en#details`);
 await page.locator('[data-session-id="ledger-e2e"] [data-ledger-thread]').click();
 const dialog=page.locator('#ledgerDialog');
 const old=dialog.locator('[data-ledger-turn-id="old-turn"]');
 await old.locator('[data-ledger-expand]').click();
 await expect(old.locator('.ledger-message')).toHaveCount(100);
 await old.getByText('Expand full message',{exact:true}).click();
 await expect(old.locator('.ledger-message-body')).toHaveAttribute('open','');
 await old.getByRole('button',{name:'Load more messages'}).click();
 await expect(old.locator('.ledger-message')).toHaveCount(106);
 await expect(old.getByRole('button',{name:'Load more messages'})).toBeHidden();
 const bar=old.locator('[data-level="turn"]');
 await bar.click();
 await expect(bar).toHaveAttribute('aria-pressed','true');
 await expect(dialog.locator('[data-ledger-bar][data-level="chat"]')).toHaveClass(/has-projection/);
 await bar.click();
 await expect(bar).toHaveAttribute('aria-pressed','false');
 await expect(dialog.locator('[data-ledger-bar][data-level="chat"]')).not.toHaveClass(/has-projection/);
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
});

test('old records remain readable and the dialog fits a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/sessions?**',async route=>{const response=await route.fetch();const data=await response.json();data.items.forEach(item=>item.title='很长的聊天标题用于验证弹窗不会把按钮挤出窗口。'.repeat(12));await route.fulfill({response,json:data})});
 await page.goto(`${url}/?lang=zh-CN#details`);
 await page.locator('[data-session-id="ledger-e2e"] [data-ledger-thread]').click();
 const dialog=page.locator('#ledgerDialog');
 await dialog.locator('[data-ledger-turn-id="old-turn"] [data-ledger-expand]').click();
 await expect(dialog.locator('.ledger-unavailable')).toContainText('调用明细不可用');
 await expect(dialog.locator('.ledger-user')).toContainText('old question');
 const bounds=await dialog.boundingBox();
 expect(bounds.x).toBeGreaterThanOrEqual(0);
 expect(bounds.width).toBeLessThanOrEqual(390);
 expect(await dialog.evaluate(x=>x.scrollWidth<=x.clientWidth)).toBe(true);
 expect(await dialog.locator('.ledger-dialog-frame').evaluate(x=>x.scrollWidth<=x.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
});
