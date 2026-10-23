import { build } from 'vite'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const output=resolve('output/qa/document-resources')
await mkdir(output,{recursive:true})
await build({configFile:false,root:process.cwd(),build:{outDir:join(output,'built'),emptyOutDir:true,rolldownOptions:{input:resolve('scripts/fixtures/document-resources.html')}}})
let deployed=false;const lateAssets=[]
const server=createServer(async(req,res)=>{
  if(req.url==='/simulate-deploy'){deployed=true;res.end('new deployment');return}
  if(deployed&&/\/assets\/.*\.(js|css)/.test(req.url)){lateAssets.push(req.url);res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>New deployment</body></html>');return}
  const path=resolve(output,'built','.'+decodeURIComponent(req.url.split('?')[0]))
  if(!path.startsWith(join(output,'built'))){res.writeHead(403);res.end();return}
  try {const bytes=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(bytes)}catch{res.writeHead(404);res.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port
try {
  const profile=await mkdtemp(join(tmpdir(),'sj-document-qa-'))
  const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'})
  let socket
  try {
    let debugPort
    for(let attempt=0;attempt<100;attempt++){try{debugPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await new Promise(r=>setTimeout(r,100))}}
    assert.ok(debugPort,'Chrome started with an isolated QA profile')
    const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl)
    await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})})
    let sequence=0;const pending=new Map()
    socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result)}})
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
    await send('Page.enable');await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/scripts/fixtures/document-resources.html`})
    let encoded
    for(let attempt=0;attempt<100;attempt++){
      const probe=await send('Runtime.evaluate',{expression:"JSON.stringify({result:document.getElementById('qa-result')?.textContent,error:document.getElementById('qa-error')?.textContent})",returnByValue:true})
      const value=JSON.parse(probe.result.value||'{}');assert.ok(!value.error,value.error)
      if(value.result){encoded=value.result;break}await new Promise(r=>setTimeout(r,300))
    }
    assert.ok(encoded,'Browser completed document generation after assets disappeared')
    const result=JSON.parse(encoded)
    assert.ok(result.headers.every(Boolean),'All five generated files have valid PDF/ZIP headers')
    assert.equal(result.downloadCount,2);assert.deepEqual(lateAssets,['/assets/obsolete.js'],'Only the deliberate obsolete import failed; document engines did not fetch late chunks')
    assert.equal(result.noticeCount,1);assert.equal(result.draft,'Retorno 4,08 sin guardar');assert.equal(result.pending.id,'preserve-me');assert.equal(result.pending.status,'queued');assert.ok(result.safeLink)
    for(const width of [320,360,390,430,768,1024,1280]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768})
      const probe=await send('Runtime.evaluate',{expression:"JSON.stringify({width:innerWidth,page:document.documentElement.scrollWidth,left:document.getElementById('resource-recovery-notice').getBoundingClientRect().left,right:document.getElementById('resource-recovery-notice').getBoundingClientRect().right})",returnByValue:true})
      const bounds=JSON.parse(probe.result.value);assert.equal(bounds.width,width);assert.ok(bounds.page<=width,JSON.stringify(bounds));assert.ok(bounds.left>=0&&bounds.right<=width,JSON.stringify(bounds))
      if(width===390||width===1280){const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`recovery-${width}.png`),Buffer.from(screenshot.data,'base64'))}
    }
    console.log('PASS Chrome: PDF despacho/cierre/ingresos, PDF/Excel reportes después de despliegue; aviso único, formulario y operación pendientes conservados; sin recargas ni peticiones tardías a librerías. Responsive 320/360/390/430/768/1024/1280 sin overflow.')
  } finally { if(socket)socket.close();chrome.kill() }
} finally { await new Promise(resolve=>server.close(resolve)) }
