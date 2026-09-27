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
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-one',usage:usage(8,2,10,3),turn_token_usage:usage(8,2,10,3)}),
  line('response_item',{type:'custom_tool_call_output',call_id:'call-one',output:'tool result'}),
  line('turn_context',{turn_id:'new-turn',model:'gpt-6-luna'}),
  line('response_item',{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:'second answer'}],internal_chat_message_metadata_passthrough:{turn_id:'new-turn'}}),
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-two',usage:usage(12,3,15,6),turn_token_usage:usage(20,5,25,9)}),
  line('turn_context',{turn_id:'old-turn',model:'gpt-5.4'}),
  line('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'old question'}]}),
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
 expect(turn.codex_credits.credits).toBeTruthy();
 expect(turn.api_equivalent.usd).toBeTruthy();
 expect(new Set(turn.models)).toEqual(new Set(['gpt-6-sol','gpt-6-luna']));
 expect(turn.messages.some(x=>x.kind==='tool_result'&&x.text==='tool result')).toBe(true);
 expect(data.turns.find(x=>x.id==='old-turn').calls).toEqual([]);
 await page.goto(`${url}/?lang=zh-CN#details`);
 const scriptCount=await page.locator('script').count();
 const row=page.locator('[data-session-id="ledger-e2e"]');
 await expect(row).toBeVisible();
 await expect(row.locator('a[href="codex://threads/ledger-e2e"]')).toBeVisible();
 await row.locator('[data-ledger-thread]').click();
 await expect(row.locator('[data-ledger-turn]')).toHaveCount(2);
 await row.locator('[data-ledger-turn="new-turn"]').click();
 await expect(row.locator('.ledger-call')).toHaveCount(2);
 await expect(row.locator('.ledger-message')).toContainText(['question <script>bad()</script>']);
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
  line('token_usage_record',{thread_id:'ledger-e2e',turn_id:'new-turn',response_id:'response-three',usage:usage(8,2,10,4),turn_token_usage:usage(28,7,35,13)})
 ].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await new Promise((resolve,reject)=>{const hook=spawn(path.resolve(binary),['hook-stop','--state-dir',state],{env:{...process.env,CODEX_USAGE_HOME:''},stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';hook.stdout.on('data',b=>output+=b);hook.stdin.end(JSON.stringify({session_id:'ledger-e2e',turn_id:'new-turn'}));hook.on('error',reject);hook.on('exit',code=>code===0&&output.trim()==='{}'?resolve():reject(new Error(`hook exit ${code}: ${output}`)))});
 await expect.poll(async()=>{const r=await fetch(`${url}/api/v1/ledger?thread_id=ledger-e2e`);return (await r.json()).usage.total}).toBe(40);
});
