// Closure detail and inventory PDF checks. Emulator only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const output=path.resolve('../PACHAX_QA_RESULTS/Embutidos-San-Jose');fs.mkdirSync(output,{recursive:true})
async function login(browser,email){const context=await browser.newContext({viewport:{width:360,height:800},acceptDownloads:true});const page=await context.newPage();await page.goto('http://127.0.0.1:5180');await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill('demo1234');await page.getByRole('button',{name:'Iniciar Sesión',exact:true}).click();await page.locator('.distribution-header').waitFor();return{context,page}}
async function nav(page,name){const direct=page.getByRole('button',{name,exact:true}).filter({visible:true});if(await direct.count())await direct.first().click();else{await page.getByRole('button',{name:'Mas',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name,exact:true}).click()}await page.waitForTimeout(250)}
async function openClosureWith(page,route,requiredText){
 const buttons=page.getByRole('button',{name:new RegExp(route)})
 await buttons.first().waitFor({timeout:10000})
 await page.waitForTimeout(400)
 for(let index=0;index<await buttons.count();index++){
  const button=buttons.nth(index);await button.click();const article=button.locator('xpath=ancestor::article[1]');const text=(await article.innerText()).toLocaleLowerCase('es')
  if(requiredText.every(label=>text.includes(label)))return{button,article,text}
  await button.click()
 }
 throw new Error(`No se encontró un cierre de ${route} con el detalle esperado`)
}
;(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});const contexts=[];try{
 const adminLogin=await login(browser,'admin@sanjose.bo');contexts.push(adminLogin.context);const admin=adminLogin.page;await nav(admin,'Cierre');for(const route of ['Zona Norte','Zona Sud']){const opened=await openClosureWith(admin,route,['entregado','vendido','devuelto','ventas efectivo','efectivo esperado']);assert(opened.text.includes('ventas efectivo')&&opened.text.includes('efectivo esperado'),`Admin ve dinero de ${route}`);await opened.button.click()}
 const whLogin=await login(browser,'almacen@sanjose.bo');contexts.push(whLogin.context);const warehouse=whLogin.page;await nav(warehouse,'Cierre');const whOpened=await openClosureWith(warehouse,'Zona Sud',['entregado','devuelto']);assert(!whOpened.text.includes('ventas efectivo')&&!whOpened.text.includes('efectivo esperado'),'Almacén no ve detalle financiero');assert.equal(await warehouse.getByRole('button',{name:/Zona Norte/}).count(),0,'Almacén central no ve cierre de almacén interno')
 for(const [email,own,other] of [['hugo@sanjose.bo','Zona Norte','Zona Sud'],['ricardo@sanjose.bo','Zona Sud','Zona Norte']]){const loginResult=await login(browser,email);contexts.push(loginResult.context);await nav(loginResult.page,'Cierre');await loginResult.page.getByRole('button',{name:new RegExp(own)}).waitFor({timeout:10000});assert.equal(await loginResult.page.getByRole('button',{name:new RegExp(other)}).count(),0,`${email} no ve cierre ajeno`)}
 for(const [label,page] of [['admin',admin],['warehouse',warehouse]]){await nav(page,'Inventario');await page.getByRole('button',{name:'Historial general de inventario',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Historial general de inventario',exact:true}).waitFor();const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'Descargar PDF',exact:true}).click();const download=await downloadPromise;const target=path.join(output,`historial-inventario-${label}.pdf`);await download.saveAs(target);const bytes=fs.readFileSync(target);assert(bytes.length>1000&&bytes.subarray(0,4).toString()==='%PDF',`${label} descarga PDF válido`);await dialog.getByRole('button',{name:'Cerrar',exact:true}).last().click()}
 const result={passed:true,at:new Date().toISOString(),adminFullDetail:true,warehouseProductOnly:true,distributorOwnClosureOnly:true,inventoryPdf:['admin','warehouse']};fs.writeFileSync(path.join(output,'histories-result.json'),JSON.stringify(result,null,2));console.log('PASS cierres por rol e historial de inventario PDF')
}finally{for(const context of contexts)await context.close().catch(()=>{});await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
