import { exportPdf, exportExcel } from '../../src/modules/distribution/data/reportExports'
import { generateDispatchPdf, generateClosurePdf } from '../../src/modules/distribution/data/distributionDocumentPrintService'
import { generateTodayIntakesPdfBytes } from '../../src/modules/distribution/domain/todayIntakes'
import { normalizeClosure } from '../../src/modules/distribution/domain/closurePeriod'

async function test() {
  const downloads: Blob[] = []
  const originalUrl = URL.createObjectURL.bind(URL)
  URL.createObjectURL = blob => { downloads.push(blob as Blob); return originalUrl(blob) }
  HTMLAnchorElement.prototype.click = function () { /* capture file bytes without filesystem side effects */ }
  const draft = document.getElementById('draft') as HTMLInputElement
  draft.value = 'Retorno 4,08 sin guardar'
  localStorage.setItem('qa-pending-operation', JSON.stringify({status:'queued',id:'preserve-me'}))
  await fetch('/simulate-deploy') // Subsequent JS/CSS requests now fail, like obsolete hashes.
  const sheet = {name:'QA',headers:['Producto','Cantidad'],rows:[['Viena',2.1]]}
  const dispatch = {id:'qa',dayKey:'2026-10-23',createdAt:'2026-10-23T11:20:00Z',routeName:'Sacaba',distributorName:'QA',warehouseId:'central',lines:[{productId:'p',productName:'Viena',unitType:'kg',quantity:10.2,normalQuantity:10,dispatchMerma:.2}],additions:[]}
  const dispatchPdf = await generateDispatchPdf(dispatch as never)
  const closurePdf = await generateClosurePdf(normalizeClosure({id:'closure-qa',status:'closed',dayKey:'2026-10-23',routeName:'Sacaba',products:[]}))
  const intakePdf = await generateTodayIntakesPdfBytes({products:[{id:'p',name:'Viena',unitType:'kg'}],warehouses:[],lots:[],movements:[{id:'intake-qa',type:'intake',productId:'p',productName:'Viena',unitType:'kg',quantity:2.125,centralDelta:2.125,toLocation:'central',dayKey:'2026-10-23',createdAt:'2026-10-23T11:00:00Z'}]} as never,'central','2026-10-23')
  await exportPdf([sheet],'23/10/2026','qa.pdf')
  await exportExcel([sheet],'23/10/2026','qa.xlsx')
  const bytes=await Promise.all(downloads.map(b=>b.arrayBuffer().then(b=>new Uint8Array(b))))
  const pdfHeader=(b:Uint8Array)=>new TextDecoder().decode(b.slice(0,4))==='%PDF'
  const headers=[pdfHeader(new Uint8Array(dispatchPdf.output('arraybuffer'))),pdfHeader(new Uint8Array(closurePdf.output('arraybuffer'))),pdfHeader(intakePdf),pdfHeader(bytes[0]),bytes[1]?.[0]===80&&bytes[1]?.[1]===75]
  // A real obsolete import now receives SPA HTML, matching the production failure.
  await new Promise<void>(resolve => {
    window.addEventListener('unhandledrejection', () => resolve(), { once: true })
    const obsolete = '/assets/obsolete.js'
    void import(/* @vite-ignore */ obsolete)
  })
  const event = new Event('vite:preloadError') as Event & {payload:Error}
  event.payload = new TypeError('Failed to fetch dynamically imported module: /assets/obsolete.js')
  window.dispatchEvent(event); window.dispatchEvent(event)
  const link=document.querySelector<HTMLAnchorElement>('#resource-recovery-notice a')
  const result={headers,downloadCount:downloads.length,noticeCount:document.querySelectorAll('#resource-recovery-notice').length,draft:draft.value,pending:JSON.parse(localStorage.getItem('qa-pending-operation')||'null'),safeLink:link?.target==='_blank'&&link?.rel.includes('noopener'),url:location.href}
  const output=document.createElement('pre');output.id='qa-result';output.textContent=JSON.stringify(result);document.body.append(output)
}
test().catch(error=>{const output=document.createElement('pre');output.id='qa-error';output.textContent=String(error.stack||error);document.body.append(output)})
