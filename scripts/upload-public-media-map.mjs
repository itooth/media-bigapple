import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const websiteMediaRoot = path.resolve(process.argv[2]);
const sourceLibraryRoot = path.resolve(process.argv[3]);
const outputFile = path.resolve(process.argv[4]);
const selectedFolders = process.argv.slice(5);
const publisherId = JSON.parse(await fs.readFile(path.resolve(process.env.USERPROFILE, '.bigapple/publisher.json'), 'utf8')).publisherId;
const token = JSON.parse(await fs.readFile(path.resolve(process.env.USERPROFILE, '.bigapple/deployment-credential.json'), 'utf8')).token;
const requestHeaders = {'x-bigapple-publisher-id':publisherId,Authorization:`Bearer ${token}`,'x-bigapple-skill-id':'sk_405931e4-67f2-494f-aaca-8081885f54e5','x-bigapple-skill-version':'2.3.0'};
const contentTypes={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const mediaExtensions=new Set(Object.keys(contentTypes));
async function readMap(){try{const text=await fs.readFile(outputFile,'utf8');const match=text.match(/export default (.*);\s*$/s);return match?JSON.parse(match[1]):{};}catch{return {};}}
async function saveMap(mediaMap){const temporaryFile=`${outputFile}.tmp`;await fs.mkdir(path.dirname(outputFile),{recursive:true});await fs.writeFile(temporaryFile,`export default ${JSON.stringify(mediaMap,null,2)};\n`,'utf8');await fs.rename(temporaryFile,outputFile);}
async function discoverFiles(root,current=root){const result=[];for(const entry of await fs.readdir(current,{withFileTypes:true})){const fullPath=path.join(current,entry.name);if(entry.isDirectory())result.push(...await discoverFiles(root,fullPath));else if(mediaExtensions.has(path.extname(entry.name).toLowerCase()))result.push({fullPath,relativePath:path.relative(root,fullPath).replaceAll(path.sep,'/')});}return result;}
async function activityId(folder){const manifestPath=path.join(sourceLibraryRoot,folder,'manifest.json');const manifest=JSON.parse((await fs.readFile(manifestPath,'utf8')).replace(/^\uFEFF/,''));return manifest.id||folder;}
async function uploadWithRetry(file,contentType,objectKey){const url=`https://api.bigapple.work/api/apps/media/public-objects/${objectKey.split('/').map(encodeURIComponent).join('/')}`;for(let attempt=1;attempt<=8;attempt+=1){try{const response=await fetch(url,{method:'PUT',headers:{...requestHeaders,'Content-Type':contentType},body:file});if(response.ok)return response.json();const detail=await response.text();if(![429,500,502,503,504].includes(response.status)||attempt===8)throw new Error(`${response.status} ${detail}`);}catch(error){if(attempt===8)throw error;}await new Promise(resolve=>setTimeout(resolve,attempt*2000));}throw new Error(`Upload failed: ${objectKey}`);}
const mediaMap=await readMap();const workItems=[];for(const folder of selectedFolders){const folderRoot=path.join(websiteMediaRoot,folder);const id=await activityId(folder);for(const file of await discoverFiles(folderRoot))workItems.push({...file,id,folder});}
let uploaded=0,reused=0,processed=0;
for(const item of workItems){
  const extension=path.extname(item.fullPath).toLowerCase();
  if (['.mp4','.webm','.mov'].includes(extension)) { console.log(`skip video ${item.relativePath}`); processed+=1; continue; }
  const file=await fs.readFile(item.fullPath);
  if (file.byteLength > 128*1024*1024) { console.log(`skip oversized ${item.relativePath} bytes=${file.byteLength}`); processed+=1; continue; }
  const hash=crypto.createHash('sha256').update(file).digest('hex');
  const mapKey=`${item.id}/${item.relativePath}`;
  if(mediaMap[mapKey]?.hash===hash){reused+=1;}
  else{
    const objectKey=`media/${hash}/${hash}${extension}`;
    const payload=await uploadWithRetry(file,contentTypes[extension],objectKey);
    if(!payload.publicUrl)throw new Error(`Missing public URL: ${mapKey}`);
    mediaMap[mapKey]={hash,url:payload.publicUrl,bytes:file.byteLength};
    uploaded+=1;
    await saveMap(mediaMap);
  }
  processed+=1;
  if(processed%10===0||processed===workItems.length)console.log(`processed ${processed}/${workItems.length} uploaded=${uploaded} reused=${reused}`);
}await saveMap(mediaMap);console.log(`done files=${workItems.length} uploaded=${uploaded} reused=${reused}`);
