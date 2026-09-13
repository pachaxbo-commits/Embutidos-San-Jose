// Responsive traversal of every module allowed to each role. Emulator only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = 'http://127.0.0.1:5180'
const output = path.resolve('../PACHAX_QA_RESULTS/Embutidos-San-Jose')
const roles = {
  admin: { email: 'admin@sanjose.bo', modules: ['Inicio','Vender','Creditos','Gastos','Cierre','Inventario','Despachos','Cobros','Clientes','Productos','Reportes','Usuarios','Cambios y devoluciones','Verificar QR','Almacenes','Impresoras'] },
  warehouse: { email: 'almacen@sanjose.bo', modules: ['Inicio','Cierre','Inventario','Despachos','Almacenes'] },
  hugo: { email: 'hugo@sanjose.bo', modules: ['Inicio','Vender','Creditos','Gastos','Cierre','Impresoras'] },
  ricardo: { email: 'ricardo@sanjose.bo', modules: ['Inicio','Vender','Creditos','Gastos','Cierre','Impresoras'] },
}
const sizes = [
  {width:412,height:915},
  {width:768,height:1024},
  {width:800,height:360},
  {width:1366,height:768},
  {width:1920,height:1080},
]

async function nav(page, name) {
  const direct = page.getByRole('button',{name,exact:true}).filter({visible:true})
  if (await direct.count()) await direct.first().click()
  else {
    await page.getByRole('button',{name:'Mas',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name,exact:true}).click()
  }
  if (name === 'Impresoras') await page.getByRole('heading',{name:'Configurar impresora',exact:true}).waitFor()
  else await page.locator('main').waitFor()
  await page.waitForTimeout(80)
}

async function main() {
  const browser = await chromium.launch({headless:true,channel:'chrome'})
  const checks=[]
  try {
    for (const [role,config] of Object.entries(roles)) for (const size of sizes) {
      const context=await browser.newContext({viewport:size})
      const page=await context.newPage()
      const pageErrors=[]
      page.on('pageerror',error=>pageErrors.push(error.message))
      await page.goto(base)
      await page.locator('input[type=email]').fill(config.email)
      await page.locator('input[type=password]').fill('demo1234')
      await page.getByRole('button',{name:'Iniciar Sesión',exact:true}).click()
      await page.locator('.distribution-header').waitFor()
      for (const moduleName of config.modules) {
        await nav(page,moduleName)
        const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,headerTop:document.querySelector('.distribution-header')?.getBoundingClientRect().top??0,text:document.body.innerText}))
        assert(geometry.scrollWidth<=geometry.width+1,`${role} ${size.width} ${moduleName}: desborde horizontal`)
        assert(geometry.headerTop>=0,`${role} ${size.width} ${moduleName}: cabecera cortada`)
        assert(!/Missing or insufficient permissions|permission-denied/i.test(geometry.text),`${role} ${size.width} ${moduleName}: permisos`)
        checks.push(`${role}:${size.width}x${size.height}:${moduleName}`)
        if (role === 'admin' && moduleName === 'Reportes' && size.width >= 1366) {
          await page.screenshot({path:path.join(output,`responsive-reportes-${size.width}x${size.height}.png`),fullPage:false})
        }
        if(moduleName==='Impresoras')await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).last().click()
      }
      assert.deepEqual(pageErrors,[],`${role} ${size.width}: errores de página`)
      await page.screenshot({path:path.join(output,`responsive-${role}-${size.width}x${size.height}.png`),fullPage:false})
      await context.close()
    }
    const result={passed:true,at:new Date().toISOString(),sizes,checks:checks.length,roles:Object.keys(roles)}
    fs.writeFileSync(path.join(output,'responsive-matrix-result.json'),JSON.stringify(result,null,2))
    console.log(`PASS responsive: ${checks.length} combinaciones de rol, sección y tamaño`)
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
