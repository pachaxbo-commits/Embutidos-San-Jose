import assert from 'node:assert/strict'
import fs from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/'})
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'rectification-repository-mock',enforce:'pre',resolveId(source,importer){if(source==='../data/distributionRepository'&&importer?.endsWith('/ClosureView.tsx'))return'\0rectification-repository'},load(id){if(id!=='\0rectification-repository')return;return`export const subscribeSales=(_d,_r,cb)=>{cb([]);return()=>{}};export const subscribeCollections=subscribeSales;export const subscribeExpenses=subscribeSales;export const declareRouteReturn=async()=>{throw Error('Read only')};export const reopenClosure=declareRouteReturn;export const saveClosure=declareRouteReturn;export const setClosureVarianceReviewed=declareRouteReturn;`}}]})
const root=createRoot(document.getElementById('app')),container=document.getElementById('app')
try{
  const {normalizeClosure}=await vite.ssrLoadModule('/src/modules/distribution/domain/closurePeriod.ts')
  const {closureRectificationView}=await vite.ssrLoadModule('/src/modules/distribution/domain/closureRectification.ts')
  const {ClosureView}=await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
  const {toDayKey}=await vite.ssrLoadModule('/src/modules/distribution/domain/engine.ts')
  const {reportSheets}=await vite.ssrLoadModule('/src/modules/distribution/data/reportExports.ts')
  const today=toDayKey(new Date())
  const original={id:'closure-rectification-view-qa',restaurantId:'sanjose',routeId:'route-sud',routeName:'Zona Sud',dispatchId:'dispatch-qa',distributorUid:'ricardo',distributorName:'Ricardo QA',warehouseId:'central',status:'closed',dayKey:today,createdAt:new Date().toISOString(),closedAt:new Date().toISOString(),warehouseClosedBy:'warehouse',products:[{productId:'tocino',productName:'Sachet Tocino ahumado',unitType:'package',initialDispatch:15,additions:0,totalLoaded:15,sold:14,courtesy:0,expectedReturn:3,actualReturn:3,physicalReturn:3,returnMerma:0,returnWaste:0,shortage:0,overage:0,variance:0}],cashSales:3337,qrSales:941,creditGenerated:1779.01,cashCollections:132.5,qrCollections:0,cashExpenses:35,claimCash:0,expectedCash:3434.5,physicalCashDeclared:3235,cashDifference:-199.5}
  const corrected={...original,products:original.products.map(p=>({...p,sold:12})),cashSales:3217.5,qrSales:891,expectedCash:3315,cashDifference:-80}
  const audit={id:'rectification-view-qa',version:1,closureId:original.id,createdAt:new Date().toISOString(),createdBy:'admin',createdByName:'Administración QA',reason:'Separar ventas centrales de Administración',operationId:'operation-qa',original,corrected,changes:[{field:'products.tocino.sold',before:14,after:12,sourceDocumentIds:['distSales/central-sale']}],sourceDocumentIds:['distSales/central-sale'],excludedSaleIds:['central-sale']}
  const raw={...original,rectificationId:audit.id,rectification:audit},normalized=normalizeClosure(raw)
  assert.equal(raw.products[0].sold,14);assert.equal(normalized.products[0].sold,12);assert.equal(normalized.expectedCash,3315)
  assert.equal(closureRectificationView(normalized,'original').products[0].sold,14)
  const data={openDispatches:[],closures:[normalized],sales:[],collections:[],expenses:[],claims:[],balances:[],lots:[],products:[],routes:[],warehouses:[],transfers:[],operations:[],receivables:[],receivableAdjustments:[],customers:[],movements:[],qrVerifications:[],creditStatus:[],supportSettings:{requireQrVerification:false}}
  const session={restaurantId:'sanjose',restaurantName:'Embutidos San José',uid:'admin',userName:'Administración',role:'admin',warehouseId:'central',routeId:null,dayKeys:[today],setDayKeys:()=>{},can:()=>true}
  await act(async()=>root.render(React.createElement(ClosureView,{session,data})))
  const click=async text=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(button,`Missing ${text}`);await act(async()=>button.click())}
  await click('Historial de cierres');await click('Ver detalle')
  assert.match(container.textContent,/RECTIFICADO/);assert.match(container.textContent,/Separar ventas centrales/)
  await click('Ver cierre original');assert.match(container.textContent,/Mostrando: cierre original preservado/)
  const originalCard=[...container.querySelectorAll('strong')].find(s=>s.textContent==='Sachet Tocino ahumado').closest('.rounded-xl')
  assert.match(originalCard.textContent,/Vendido14/)
  await click('Ver cierre conciliado')
  const correctedCard=[...container.querySelectorAll('strong')].find(s=>s.textContent==='Sachet Tocino ahumado').closest('.rounded-xl')
  assert.match(correctedCard.textContent,/Vendido12/)
  assert.equal(container.querySelectorAll('button button').length,0)
  console.log('PASS React real: Historial → RECTIFICADO → original 14 / conciliado 12, motivo y auditoría, sin botones anidados')
  const sheets=reportSheets({...data,closures:[raw]},[today])
  const cash=sheets.find(s=>s.name==='Arqueos'),row=cash.rows.find(r=>r[6]==='Ricardo QA')
  assert.equal(row[9],3315);assert.equal(row[11],-80);assert.match(row[12],/RECTIFICADO/);assert.equal(row[13],-199.5)
  const returns=sheets.find(s=>s.name==='Detalle de retorno').rows.find(r=>r[2]==='Sachet Tocino ahumado')
  assert.equal(returns[5],12);assert.match(returns[1],/RECTIFICADO/)
  console.log('PASS exportaciones: usan conciliado, identifican RECTIFICADO y conservan diferencia original −199.50')
  if(process.argv.includes('--pdf')){
    const {generateClosurePdf}=await vite.ssrLoadModule('/src/modules/distribution/data/distributionDocumentPrintService.ts')
    fs.mkdirSync('output/pdf',{recursive:true})
    for(const mode of ['original','corrected']){
      const pdf=await generateClosurePdf(closureRectificationView(normalized,mode))
      fs.writeFileSync(`output/pdf/ricardo-rectification-${mode}-qa.pdf`,Buffer.from(pdf.output('arraybuffer')))
    }
    console.log('PASS generados PDF original/conciliado QA para revisión visual')
  }
}finally{await act(async()=>root.unmount());await vite.close();dom.window.close()}
