import fs from 'node:fs'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, increment } from 'firebase/firestore'

const env = await initializeTestEnvironment({ projectId: 'demo-sanjose-updates', firestore: {host:'127.0.0.1',port:8085,rules:fs.readFileSync('firebase/firestore.rules','utf8')} })
const path = (db, collection, id) => doc(db,'restaurants','test',collection,id)
const member = (role, other={}) => ({role,active:true,...other})
let passed=0
const check = async (name, action) => { await action; console.log(`PASS: ${name}`); passed++ }
try {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db=context.firestore()
    for (const [id,data] of Object.entries({admin:member('admin'),central:member('warehouse'),internal:member('warehouse',{warehouseId:'internal'}),hugo:member('distributor',{routeId:'north'}),inactive:{role:'admin',active:false}})) await setDoc(path(db,'members',id),data)
    for (const [id,locationKind,routeId,quantity] of [['central__p','central','',10],['route__north__p','route','north',5],['route__south__p','route','south',10]]) await setDoc(path(db,'distBalances',id),{id,restaurantId:'test',productId:'p',locationKind,routeId,quantity})
    await setDoc(path(db,'distDispatches','dispatch'),{restaurantId:'test',warehouseId:'internal',routeId:'north',status:'open'})
    await setDoc(path(db,'distReceivables','debt'),{restaurantId:'test',routeId:'north',originalAmount:100,paidAmount:0,balance:100,status:'OPEN'})
    await setDoc(path(db,'distSales','qr'),{restaurantId:'test',routeId:'north',qrAmount:48})
  })
  const admin=env.authenticatedContext('admin').firestore()
  const hugo=env.authenticatedContext('hugo').firestore()
  const internal=env.authenticatedContext('internal').firestore()
  const inactive=env.authenticatedContext('inactive').firestore()
  await check('distribuidor no altera stock central',assertFails(updateDoc(path(hugo,'distBalances','central__p'),{quantity:1000})))
  await check('distribuidor no altera otra ruta',assertFails(updateDoc(path(hugo,'distBalances','route__south__p'),{quantity:1000})))
  await check('stock negativo bloqueado incluso para admin',assertFails(updateDoc(path(admin,'distBalances','route__north__p'),{quantity:-1})))
  await check('almacen interno no despacha desde central',assertFails(setDoc(path(internal,'distDispatches','wrong'),{restaurantId:'test',warehouseId:'central',routeId:'north'})))
  await check('almacen interno despacha desde su stock',assertSucceeds(setDoc(path(internal,'distDispatches','own'),{restaurantId:'test',warehouseId:'internal',routeId:'north'})))
  await check('miembro inactivo no lee catalogo',assertFails(getDoc(path(inactive,'distProducts','p'))))
  const declaration={id:'closure',restaurantId:'test',dispatchId:'dispatch',routeId:'north',declaredReturns:{p:5},returnDeclaredBy:'hugo',returnDeclaredAt:new Date().toISOString(),dayKey:'2026-09-05'}
  await check('distribuidor declara retorno',assertSucceeds(setDoc(path(hugo,'distClosures','closure'),declaration)))
  await check('declarar retorno no modifica stock',Promise.resolve().then(async()=>assert.equal((await getDoc(path(admin,'distBalances','route__north__p'))).data().quantity,5)))
  await check('distribuidor no confirma recepcion de almacen',assertFails(updateDoc(path(hugo,'distClosures','closure'),{warehouseClosedBy:'hugo',status:'warehouse_done'})))
  await check('distribuidor no cierra antes de recepcion',assertFails(updateDoc(path(hugo,'distClosures','closure'),{status:'closed',closedBy:'hugo',physicalCashDeclared:0})))
  await check('cobro negativo en saldo bloqueado',assertFails(updateDoc(path(hugo,'distReceivables','debt'),{paidAmount:110,balance:-10,status:'PAID'})))
  const otherDevice=env.authenticatedContext('hugo').firestore()
  await Promise.all([
    updateDoc(path(hugo,'distReceivables','debt'),{paidAmount:increment(20),balance:increment(-20),status:'PARTIAL'}),
    updateDoc(path(otherDevice,'distReceivables','debt'),{paidAmount:increment(30),balance:increment(-30),status:'PARTIAL'}),
  ])
  await check('dos dispositivos conservan los cobros',Promise.resolve().then(async()=>assert.equal((await getDoc(path(admin,'distReceivables','debt'))).data().balance,50)))
  const verification={id:'sale_qr',restaurantId:'test',routeId:'north',sourceType:'sale',sourceId:'qr',amount:48,verifiedBy:'hugo',verifiedAt:new Date().toISOString(),reference:'Banco123'}
  await check('distribuidor no verifica su propio QR',assertFails(setDoc(path(hugo,'distQrVerifications','sale_qr'),verification)))
  await check('admin no inventa monto del QR',assertFails(setDoc(path(admin,'distQrVerifications','sale_qr'),{...verification,verifiedBy:'admin',amount:1000})))
  await check('admin verifica monto original',assertSucceeds(setDoc(path(admin,'distQrVerifications','sale_qr'),{...verification,verifiedBy:'admin'})))
  await check('verificacion bancaria inmutable',assertFails(updateDoc(path(admin,'distQrVerifications','sale_qr'),{amount:1})))
  console.log(`${passed} passed / 0 failed`)
} finally { await env.cleanup() }
