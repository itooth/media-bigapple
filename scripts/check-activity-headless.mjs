import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const output=path.join(root,'.work/activity-preview-check');
const browser=await (await fetch('http://127.0.0.1:9333/json/version')).json();
const socket=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let id=0;const pending=new Map();
socket.onmessage=event=>{const message=JSON.parse(event.data);pending.get(message.id)?.(message)};
async function cdp(method,params={},sessionId){
  const key=++id;
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(new Error(method+' timed out'))},20000);pending.set(key,r=>{clearTimeout(timer);pending.delete(key);resolve(r)});socket.send(JSON.stringify({id:key,method,params,sessionId}))});
  if(result.error)throw new Error(JSON.stringify(result.error));return result.result;
}
const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
const views=[];
try{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await cdp('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false},sessionId);
    for(const [name,route] of [['lawyers','/events/08-23-18'],['lawyers-more','/events/08-23-18/gallery'],['aichong','/events/01-1'],['cases-more','/events/01-1/production-gallery']]){
      await cdp('Page.navigate',{url:'http://127.0.0.1:5173'+route},sessionId);
      for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,150));if(await evaluate(`document.querySelectorAll('.justified-gallery').length>0`))break}
      await evaluate(`(async()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager');await Promise.race([Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,6000))]);await new Promise(r=>setTimeout(r,500));return true})()`);
      const layout=await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,groups:[...document.querySelectorAll('.justified-gallery')].map(g=>({label:g.getAttribute('aria-label'),rows:g.querySelectorAll('.justified-row').length,images:[...g.querySelectorAll('img')].map(i=>({src:i.getAttribute('src'),ok:i.naturalWidth>0,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,ratio:i.naturalWidth/i.naturalHeight,fit:getComputedStyle(i).objectFit}))}))})`);
      views.push({name,viewport,...layout});
      const shot=await cdp('Page.captureScreenshot',{format:'png'},sessionId);
      fs.writeFileSync(path.join(output,`${name}-${viewport.width}.png`),Buffer.from(shot.data,'base64'));
      console.log(JSON.stringify({name,width:layout.width,overflow:layout.overflow,groups:layout.groups.map(g=>({label:g.label,rows:g.rows,count:g.images.length,broken:g.images.filter(i=>!i.ok).length}))}));
    }
  }
  await cdp('Page.navigate',{url:'http://127.0.0.1:5173/'},sessionId);
  await new Promise(r=>setTimeout(r,700));
  const media=await evaluate(`(async()=>{const {allEvents}=await import('/src/data/events.js');const urls=[...new Set(allEvents.flatMap(e=>[e.image,...e.detail.highlights.map(i=>i.image)]).filter(Boolean))];const failures=[];let cursor=0;await Promise.all(Array.from({length:6},async()=>{while(cursor<urls.length){const src=urls[cursor++];const i=new Image();i.src=src;try{await i.decode()}catch{failures.push(src)}}}));return {events:allEvents.length,checked:urls.length,failures,aprilHidden:!allEvents.some(e=>e.id==='04-2')}})()`);
  fs.writeFileSync(path.join(output,'headless-report.json'),JSON.stringify({media,views},null,2));
  console.log(JSON.stringify(media));
  const failures=views.flatMap(v=>v.groups.flatMap(g=>g.images.filter(i=>i.ok&&Math.abs(i.width/i.height-i.ratio)>0.025).map(i=>({view:v.name,image:i.src}))));
  if(media.failures.length||failures.length||views.some(v=>v.overflow))throw new Error(JSON.stringify({failures}));
}finally{await cdp('Browser.close');socket.close()}
