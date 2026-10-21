// node hub/check-pages.js hub/Code.gs  -> evaluates every *_HTML page in Code.gs and syntax-checks its inline <script>. Run before pasting Code.gs.
const dir=require("fs").mkdtempSync(require("os").tmpdir()+"/hub-");
const fs=require('fs'),cp=require('child_process'),src=fs.readFileSync(process.argv[2],'utf8');
const stub='const SpreadsheetApp={},PropertiesService={getScriptProperties:()=>({getProperty:()=>""})},Utilities={},MailApp={},CalendarApp={},ContentService={},HtmlService={},Session={},UrlFetchApp={},DriveApp={},ScriptApp={},LockService={},CacheService={},Logger={log(){}};';
const names=[...src.matchAll(/^const (\w+_HTML)\s*=/gm)].map(m=>m[1]);
const vals=new Function(stub+src+'\nreturn {'+names.join(',')+'};')();
let bad=0;for(const n of names){const scripts=[...vals[n].matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((s,i)=>{const f=dir+`/${n}-${i}.js`;fs.writeFileSync(f,s);try{cp.execSync(`node --check ${f}`,{stdio:'pipe'})}catch(e){bad++;console.log(n,i,String(e.stderr).split('\n').slice(0,5).join('\n'))}});
 console.log(n,scripts.length,'scripts');}
process.exit(bad?1:0);
