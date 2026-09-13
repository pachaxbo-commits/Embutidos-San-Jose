// Integration tests use only the local Firebase emulators. No production writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = 'http://127.0.0.1:5180'
const repo = '/src/modules/distribution/data/distributionRepository.ts'
const output = path.resolve('../PACHAX_QA_RESULTS/Embutidos-San-Jose')
fs.mkdirSync(output, { recursive: true })
const run = async (page, name, ...args) => page.evaluate(async ({ repo, name, args }) => (await import(repo))[name](...args), { repo, name, args })
async function dbRead(page, name, id) {
  return page.evaluate(async ({name, id}) => {
    const { getFirebaseContext } = await import('/src/lib/firebase.ts')
    const { doc, getDoc } = await import((await (await fetch('/src/lib/firebase.ts')).text()).match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1])
    const ctx = await getFirebaseContext()
    return (await getDoc(doc(ctx.db, 'restaurants', ctx.restaurantId, name, id))).data()
  }, {name, id})
}
async function nav(page, name) {
  const direct = page.getByRole('button', { name, exact: true }).filter({visible:true})
  if (await direct.count()) return direct.first().click()
  await page.getByRole('button', {name:'Mas', exact:true}).click()
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
}
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const errors = []
  const login = async email => {
    const context = await browser.newContext({viewport:{width:360,height:800}})
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button',{name:'Iniciar Sesión',exact:true}).click()
    await page.locator('.distribution-header').waitFor()
    await page.waitForTimeout(500)
    return page
  }
  try {
    const admin = await login('admin@sanjose.bo')
    const suffix = Date.now().toString(36)
    const customer = await run(admin, 'saveCustomer', {name:'Cliente con mismo nombre',customerCode:`CLI-${suffix}`,identityNumber:String(Date.now()).slice(-10),routeId:'route-norte'})
    await run(admin, 'createWarehouse', `Almacen interno ${suffix}`)
    const info = await admin.evaluate(async () => {
      const firebase = await import('/src/lib/firebase.ts')
      const {getDocs,collection} = await import((await (await fetch('/src/lib/firebase.ts')).text()).match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1])
      const ctx=await firebase.getFirebaseContext()
      return {members:await firebase.listRestaurantMembers(),warehouses:(await getDocs(collection(ctx.db,'restaurants',ctx.restaurantId,'distWarehouses'))).docs.map(d=>({id:d.id,...d.data()}))}
    })
    const warehouse = info.warehouses.find(w=>w.name.endsWith(suffix))
    const hugo = info.members.find(m=>m.email==='hugo@sanjose.bo')
    const email = `interno-${suffix}@sanjose.bo`
    await admin.evaluate(async input => (await import('/src/lib/firebase.ts')).createRestaurantMember(input), {email,password:'demo1234',displayName:'Responsable interno',role:'warehouse',warehouseId:warehouse.id})
    const line = {productId:'gra-viena',productName:'Salchicha tipo Viena',unitType:'kg',quantity:10}
    await run(admin,'transferWarehouseStock','central',warehouse.id,line,'Prueba integrada',`transfer-${suffix}`)
    await run(admin,'transferWarehouseStock','central',warehouse.id,line,'Prueba integrada',`transfer-${suffix}`)
    assert.equal((await dbRead(admin,'distBalances',`warehouse__${warehouse.id}__gra-viena`)).quantity,10,'transferencia idempotente')
    const internal = await login(email)
    const dispatchId = await run(internal,'confirmDispatch',{warehouseId:warehouse.id,routeId:'route-norte',routeName:'Zona Norte',distributorUid:hugo.uid,distributorName:hugo.displayName,lines:[{...line,quantity:8}],operationId:`dispatch-${suffix}`})
    await internal.waitForTimeout(400)
    const dispatch = await dbRead(internal,'distDispatches',dispatchId)
    await run(internal,'addDispatchLoad',{dispatch,lines:[{...line,quantity:1}],registeredByName:'Responsable interno',operationId:`addition-${suffix}`})
    const seller = await login('hugo@sanjose.bo')
    const saleBase = {sourceLocation:'route',routeId:'route-norte',routeName:'Zona Norte',sellerUid:hugo.uid,sellerName:hugo.displayName,dispatchId,customerId:customer.id,customerName:customer.name,customerCode:customer.customerCode}
    const saleLine = {productId:'gra-viena',productNameSnapshot:line.productName,unitType:'kg',quantity:2,actualUnitPrice:48,subtotal:96}
    const credit = await run(seller,'registerSale',{...saleBase,operationId:`credit-${suffix}`,lines:[saleLine],total:96,paymentKind:'credit',cashAmount:0,qrAmount:0,creditAmount:96})
    await seller.waitForTimeout(350)
    const receivable = await dbRead(seller,'distReceivables',credit.id)
    await run(seller,'registerCollection',{operationId:`cash-col-${suffix}`,receivable,amount:20,method:'cash',collectedByUid:hugo.uid,collectedByName:hugo.displayName,routeId:'route-norte'})
    await seller.waitForTimeout(300)
    // Deliberately reuse the stale balance: atomic increments must retain both payments.
    await run(seller,'registerCollection',{operationId:`qr-col-${suffix}`,receivable,amount:16,method:'qr',collectedByUid:hugo.uid,collectedByName:hugo.displayName,routeId:'route-norte'})
    const qr = await run(seller,'registerSale',{...saleBase,operationId:`qr-${suffix}`,lines:[{...saleLine,quantity:1,subtotal:48}],total:48,paymentKind:'qr',cashAmount:0,qrAmount:48,creditAmount:0})
    await seller.waitForTimeout(400)
    assert.equal((await dbRead(seller,'distReceivables',credit.id)).balance,60,'dos cobros conservan ambos abonos')
    await run(admin,'verifyQr','sale',qr.id,`banco-${suffix}`)
    await run(admin,'verifyQr','collection',`qr-col-${suffix}`,`banco-cobro-${suffix}`)
    await nav(admin,'Verificar QR')
    await admin.getByText('QR confirmado',{exact:true}).waitFor()
    assert((await admin.locator('main').innerText()).includes('64.00'),'QR confirmado: venta + cobro')
    await nav(seller,'Creditos')
    await seller.getByRole('button',{name:/Cliente con mismo nombre/}).click()
    await seller.getByText('Productos de la venta original',{exact:true}).waitFor()
    assert((await seller.getByRole('dialog').innerText()).includes('Salchicha tipo Viena'),'detalle original en credito')
    await seller.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).last().click()
    await seller.evaluate(async () => {const {getFirebaseContext}=await import('/src/lib/firebase.ts');const {disableNetwork}=await import((await (await fetch('/src/lib/firebase.ts')).text()).match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1]);await disableNetwork((await getFirebaseContext()).db);window.dispatchEvent(new Event('offline'))})
    await run(seller,'registerSale',{...saleBase,operationId:`offline-${suffix}`,lines:[{...saleLine,quantity:1,subtotal:48}],total:48,paymentKind:'cash',cashAmount:48,qrAmount:0,creditAmount:0})
    await seller.reload()
    await seller.locator('.distribution-header').waitFor()
    // reload reconnects; verify durable write reached server exactly once
    await seller.waitForTimeout(1000)
    assert.equal((await dbRead(seller,'distBalances','route__route-norte__gra-viena')).quantity,5,'stock correcto despues de venta offline y recarga')
    await nav(seller,'Cierre')
    await seller.locator('input[type=number]').first().fill('5')
    await seller.getByRole('button',{name:'Declarar retorno para almacen',exact:true}).click()
    await seller.getByText(/Retorno declarado/).waitFor()
    await nav(admin,'Inicio')
    await admin.waitForTimeout(600)
    assert(await admin.locator('.distribution-header').isVisible(), 'panel estable con retorno declarado sin recepción')
    assert(await internal.locator('.distribution-header').isVisible(), 'panel de almacén estable con declaración pendiente')
    await nav(internal,'Cierre')
    await internal.locator('input[type=number]').first().fill('5')
    await internal.getByRole('button',{name:'Guardar retorno de almacen',exact:true}).click()
    await internal.getByRole('button',{name:'Retorno ya registrado',exact:true}).waitFor()
    assert.equal((await dbRead(admin,'distBalances',`warehouse__${warehouse.id}__gra-viena`)).quantity,6,'retorno al almacen de origen')
    assert.equal((await dbRead(seller,'distBalances','route__route-norte__gra-viena')).quantity,0,'ruta queda en cero')
    await seller.locator('input[type=number]').last().fill('68')
    await seller.getByRole('button',{name:'Cerrar ruta',exact:true}).click()
    await seller.getByText('No hay rutas abiertas',{exact:true}).waitFor()
    const closure=await dbRead(admin,'distClosures',`closure_${dispatchId}`)
    assert.equal(closure.expectedCash,68,'efectivo: venta48 + cobro20; QR separado')
    assert.equal(closure.cashDifference,0)
    await nav(admin,'Usuarios')
    for (const size of [{width:320,height:640},{width:360,height:800},{width:412,height:915},{width:800,height:360},{width:1280,height:800}]) {
      await admin.setViewportSize(size)
      const geometry=await admin.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,header:document.querySelector('.distribution-header').getBoundingClientRect().toJSON()}))
      assert(geometry.scroll<=geometry.width+1,`sin desborde horizontal ${size.width}`)
      assert(geometry.header.top>=0,`cabecera visible ${size.width}`)
      await admin.screenshot({path:path.join(output,`usuarios-${size.width}.png`),fullPage:false})
    }
    assert.deepEqual(errors,[],'sin errores React en los tres roles')
    fs.writeFileSync(path.join(output,'integration-result.json'),JSON.stringify({passed:true,dispatchId,warehouse:warehouse.id,closure,checks:['transferencia idempotente','almacen interno despacha','aumento de carga','venta credito','cobros concurrentes','verificacion QR','detalle de productos','venta offline y recarga','declaracion distribuidor','recepcion almacen','cierre efectivo','cinco viewports'],errors},null,2))
    console.log('PASS: flujo completo San Jose, tres roles, QR, credito, offline, retorno y cinco viewports')
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) for (const p of context.pages()) {
      console.error('Contexto', index, await p.locator('body').innerText())
      await p.screenshot({path:path.join(output,`failure-${index}.png`)})
    }
    throw error
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
