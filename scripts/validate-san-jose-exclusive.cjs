// Run after seed:demo, with local Auth/Firestore emulators and Vite on 5180.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'})
 try {
  const context=await browser.newContext({viewport:{width:360,height:800}})
  const p=await context.newPage()
  await p.addInitScript(()=>localStorage.setItem('pachax_active_restaurant_id','otro-negocio'))
  await p.goto('http://127.0.0.1:5180')
  await p.getByRole('button',{name:'Iniciar Sesión',exact:true}).waitFor()
  assert.equal(await p.getByText('Embutidos San José',{exact:true}).count(),1)
  assert.equal(await p.getByText('¿Registrar un restaurante nuevo?').count(),0)
  await p.screenshot({path:'../PACHAX_QA_RESULTS/Embutidos-San-Jose/login-exclusivo.png',fullPage:true})
  await p.getByLabel('Correo Electrónico').fill('admin@sanjose.bo')
  await p.getByLabel('Contraseña').fill('demo1234')
  await p.getByRole('button',{name:'Iniciar Sesión',exact:true}).click()
  await p.locator('.distribution-header').waitFor()
  assert.equal(await p.evaluate(async()=>{
   const f=await import('/src/lib/firebase.ts');return f.getFirebaseRestaurantId()
  }),'sanjose')
  assert.equal(await p.evaluate(async()=>{
   const f=await import('/src/lib/firebase.ts');try{f.setFirebaseRestaurantId('otro-negocio');return false}catch{return true}
  }),true)
  const outsider=`ajeno-${Date.now()}@prueba.local`
  const r=await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:outsider,password:'demo1234',returnSecureToken:true})})
  assert.equal(r.ok,true)
  const q=await (await browser.newContext()).newPage()
  await q.goto('http://127.0.0.1:5180')
  await q.getByLabel('Correo Electrónico').fill(outsider)
  await q.getByLabel('Contraseña').fill('demo1234')
  await q.getByRole('button',{name:'Iniciar Sesión',exact:true}).click()
  await q.getByText('Acceso no autorizado',{exact:true}).waitFor()
  assert.equal(await q.locator('.distribution-header').count(),0)
  fs.writeFileSync('../PACHAX_QA_RESULTS/Embutidos-San-Jose/exclusive-result.json',JSON.stringify({passed:true,checks:['identidad de San José','sin registro de restaurantes','ignora preferencia de otra empresa','rechaza cambio de empresa','acceso autorizado al módulo de distribución','usuario ajeno rechazado']},null,2))
  console.log('6 comprobaciones de exclusividad aprobadas')
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
