// All writes are confined to local emulators. Never point this suite at production.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing'
import {collection,getDocs,getDoc,doc,setDoc,writeBatch} from 'firebase/firestore'
const req=createRequire(new URL('../../functions/package.json',import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9095'
const {initializeApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore')
const {getAuth}=req('firebase-admin/auth')
const {processCommand,dayKey}=req('./operations.cjs')
const {prepareCleanDelivery,executeCleanDelivery}=req('./maintenance.cjs')
const projectId='demo-pachax-audit',adminApp=initializeApp({projectId},'qa-operations'),db=getFirestore(adminApp),adminAuth=getAuth(adminApp),root=db.doc('restaurants/sanjose')
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync('firebase/firestore.rules','utf8')}})
const prefix=`q${Date.now().toString(36)}`,pid=`${prefix}-p`,pid2=`${prefix}-p2`,pid3=`${prefix}-p3`,route=`${prefix}-route`,wh=`${prefix}-wh`,cust=`${prefix}-customer`,old=`${prefix}-overdue`,admin=`${prefix}-admin`,seller=`${prefix}-seller`,warehouse=`${prefix}-warehouse`
let checks=0
const ok=(v,msg)=>{assert(v,msg);checks++;console.log('PASS',msg)}
const read=async(col,id)=>(await root.collection(col).doc(id).get()).data()
async function command(actor,type,payload,expect='confirmed'){
 const id=`${prefix}-${type}-${Math.random().toString(36).slice(2)}`
 await setDoc(doc(env.authenticatedContext(actor).firestore(),'restaurants','sanjose','distOperations',id),{id,restaurantId:'sanjose',createdBy:actor,createdAt:new Date().toISOString(),type,payload,status:'queued'})
 // The emulator trigger is the production entrypoint. Poll only the resulting record.
 const until=Date.now()+60000;let op
 while(Date.now()<until){op=await read('distOperations',id);if(op.status!=='queued')break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(op.status,expect,`${type}: ${op.error||'sin procesar'}`);return {...op,id}
}
try {
 await adminAuth.createUser({uid:admin,email:`${prefix}-admin@example.test`,password:'Inicial123'})
 const passwordTarget=`${prefix}-password-target`
 await adminAuth.createUser({uid:passwordTarget,email:`${prefix}-target@example.test`,password:'Inicial123'})
 await root.collection('members').doc(admin).set({role:'admin',active:true,displayName:'QA administración'})
 await root.collection('members').doc(passwordTarget).set({role:'distributor',active:true,routeId:route,displayName:'QA contraseña'})
 await root.collection('members').doc(seller).set({role:'distributor',active:true,routeId:route,displayName:'QA vendedor'})
 await root.collection('members').doc(warehouse).set({role:'warehouse',active:true,warehouseId:wh,displayName:'QA almacén'})
 await root.collection('distWarehouses').doc(wh).set({id:wh,restaurantId:'sanjose',name:'QA interno',active:true})
 for(const [id,price,cost] of [[pid,10,5],[pid2,8,3],[pid3,6,2]])await root.collection('distProducts').doc(id).set({id,restaurantId:'sanjose',name:id,unitType:'kg',active:true,referencePrice:price,productionCost:cost})
 for(const id of [cust,old])await root.collection('distCustomers').doc(id).set({id,restaurantId:'sanjose',name:id,identityNumber:id===cust?'6543210':'6543211',customerCode:id===cust?'6543210':'6543211',active:true,createdAt:new Date().toISOString(),createdBy:admin})
 await root.collection('distReceivables').doc(`${prefix}-old`).set({id:`${prefix}-old`,restaurantId:'sanjose',customerId:old,routeId:route,originalAmount:5,paidAmount:0,balance:5,createdAt:new Date(Date.now()-8*86400000).toISOString()})
 const date=(days)=>dayKey(new Date(Date.now()+days*86400000))
 const intake=await command(admin,'intake',{lines:[{productId:pid,quantity:10,lotCode:'FUTURO',manufacturedOn:date(-10),expiresOn:date(30)},{productId:pid,quantity:2,lotCode:'PRIMERO',manufacturedOn:date(-10),expiresOn:date(5)},{productId:pid,quantity:4,lotCode:'VENCIDO',manufacturedOn:date(-10),expiresOn:date(-1)},{productId:pid2,quantity:4,lotCode:'REEMPLAZO',manufacturedOn:date(-10),expiresOn:date(30)}],note:'QA'})
 ok((await read('distBalances',`central__${pid}`)).quantity===16,'ingreso por lotes suma stock físico')
 const intakeMovements=await root.collection('distStockMovements').where('productId','==',pid).get()
 ok(intakeMovements.docs.some(entry=>entry.data().type==='intake'&&entry.data().responsibleRole==='admin'&&entry.data().responsibleName==='QA administración'),'historial de ingreso conserva rol y nombre del usuario')
 await command(admin,'updateLot',{lotId:`${intake.id}__0`,lotCode:'FUTURO-EDITADO',manufacturedOn:date(-9),expiresOn:date(31),productionCost:5,reason:'Corrección QA'})
 ok((await read('distLots',`${intake.id}__0`)).lotCode==='FUTURO-EDITADO'&&!(await root.collection('distLotHistory').where('lotId','==',`${intake.id}__0`).get()).empty,'edición de lote conserva historial anterior y nuevo')
 await command(admin,'adjustment',{warehouseId:'central',line:{productId:pid,quantity:-1},note:'Merma técnica QA'})
 ok((await read('distBalances',`central__${pid}`)).quantity===15,'ajuste negativo descuenta stock y queda auditado')
 await command(admin,'deleteProduct',{productId:pid},'rejected');checks++
 const deletedProduct=await command(admin,'deleteProduct',{productId:pid3})
 ok(deletedProduct.result.deleted==true&&(await read('distProducts',pid3)).deleted===true,'eliminación de producto exige stock cero y conserva marca de auditoría')
 const expense=await command(seller,'expense',{concept:'Combustible',amount:15,routeId:route,routeName:'QA ruta'})
 await command(admin,'deleteExpense',{expenseId:expense.id})
 ok((await read('distExpenses',expense.id)).voided===true,'gasto eliminado queda anulado para excluirlo de totales y reportes')
 await command(admin,'transfer',{from:'central',to:wh,line:{productId:pid,quantity:13},note:''},'rejected')
 ok((await read('distBalances',`central__${pid}`)).quantity===15,'lotes vencidos no se transfieren ni alteran el saldo')
 const transfer=await command(admin,'transfer',{from:'central',to:wh,line:{productId:pid,quantity:4},note:'QA'})
 ok(transfer.result.allocations[0].lotCode==='PRIMERO','FEFO prioriza el vencimiento más próximo')
 const dispatch=await command(warehouse,'dispatch',{warehouseId:wh,routeId:route,routeName:'QA ruta',distributorUid:seller,distributorName:'QA vendedor',lines:[{productId:pid,quantity:3}]})
 const base={sourceLocation:'route',routeId:route,routeName:'QA ruta',dispatchId:dispatch.id,customerId:cust,lines:[{productId:pid,quantity:2,actualUnitPrice:10}],cashAmount:0,qrAmount:0,creditAmount:20,paymentKind:'credit'}
 await command(seller,'sale',{...base,lines:[{productId:pid,quantity:2,actualUnitPrice:9}],creditAmount:18},'rejected');checks++
 await command(seller,'sale',{...base,customerId:old,creditAmount:0,cashAmount:20,paymentKind:'cash'},'rejected');checks++
 const sold=await command(seller,'sale',base)
 ok(sold.result.lines[0].costTotal===10,'venta conserva el costo histórico')
 await processCommand(db,root.collection('distOperations').doc(sold.id))
 ok((await read('distBalances',`route__${route}__${pid}`)).quantity===1,'reintento no duplica la venta')
 await command(seller,'collection',{receivable:{id:sold.id},amount:5,method:'cash'})
 await command(admin,'claim',{kind:'exchange',saleId:sold.id,productId:pid,quantity:1,replacementProductId:pid2,replacementQuantity:1,warehouseId:'central',reason:'Mal envasado',method:'cash'})
 let debt=await read('distReceivables',sold.id)
 ok(debt.balance===13&&debt.originalAmount===20&&debt.creditedAmount===2,'cambio compensa deuda sin modificar el importe original')
 await command(admin,'claim',{kind:'return',saleId:sold.id,productId:pid,quantity:1,warehouseId:'central',reason:'Deteriorado',method:'cash'})
 ok((await read('distReceivables',sold.id)).balance===3,'devolución reduce el saldo restante')
 await command(admin,'claim',{kind:'return',saleId:sold.id,productId:pid,quantity:1,warehouseId:'central',reason:'Repetido',method:'cash'},'rejected');checks++
 const closeInput={closure:{dispatchId:dispatch.id,products:[{productId:pid,actualReturn:1}],physicalCashDeclared:5},mode:'warehouse'}
 await command(warehouse,'closure',closeInput)
 ok((await read('distBalances',`warehouse__${wh}__${pid}`)).quantity===2,'retorno vuelve al almacén de origen y conserva lote')
 const closed=await command(seller,'closure',{...closeInput,mode:'money'})
 ok(closed.result.expectedCash===5&&closed.result.cashDifference===0,'cierre calcula efectivo en servidor')
 const client=env.authenticatedContext(seller).firestore()
 const adminClient=env.authenticatedContext(admin).firestore()
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distSales',`${prefix}-forged`),{restaurantId:'sanjose',routeId:route}));checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distBalances',`route__${route}__${pid}`),{quantity:999},{merge:true}));checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distOperations',`${prefix}-forged-actor`),{id:`${prefix}-forged-actor`,restaurantId:'sanjose',createdBy:admin,createdAt:new Date().toISOString(),type:'intake',payload:{},status:'queued'}));checks++
 const drafts=[{sourceLocation:'centralWarehouse',routeId:'route-directa',routeName:'Directa',lines:[{productId:pid2,quantity:2,actualUnitPrice:8}],cashAmount:16,qrAmount:0,creditAmount:0,paymentKind:'cash'},{sourceLocation:'centralWarehouse',routeId:'route-directa',routeName:'Directa',lines:[{productId:pid2,quantity:2,actualUnitPrice:8}],cashAmount:16,qrAmount:0,creditAmount:0,paymentKind:'cash'}]
 const concurrent=await Promise.allSettled(drafts.map(p=>command(admin,'sale',p)))
 ok(concurrent.filter(r=>r.status==='fulfilled').length===1,'ventas concurrentes no dejan stock negativo')

 await assertFails(setDoc(doc(client,'restaurants','sanjose','distClosures',`closure_${dispatch.id}`),{physicalCashDeclared:999,expectedCash:999},{merge:true}));checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distProducts',pid),{referencePrice:1},{merge:true}));checks++
 await command(admin,'reopen',{closureId:`closure_${dispatch.id}`});ok((await read('distDispatches',dispatch.id)).status==='open','reapertura administrativa conserva el retorno recibido')
 const status=await command(seller,'creditStatus',{customerId:old});ok(!!status.result.oldestPendingAt,'consulta de crédito funciona con clientes anteriores')
 const foreignDebtId=`${prefix}-foreign-debt`
 await root.collection('distReceivables').doc(foreignDebtId).set({id:foreignDebtId,restaurantId:'sanjose',customerId:cust,customerName:'Cliente de otra ruta',routeId:'otra-ruta',distributorUid:'otro-vendedor',originalAmount:12,paidAmount:0,balance:12,status:'OPEN',createdAt:new Date().toISOString(),dayKey:dayKey(new Date())})
 const globalCredits=await getDocs(collection(client,'restaurants','sanjose','distReceivables'))
 ok(globalCredits.docs.some(entry=>entry.id===foreignDebtId),'distribuidor ve la cartera global aunque la deuda sea de otra ruta')
 const foreignCollection=await command(seller,'collection',{receivable:{id:foreignDebtId},amount:2,method:'cash'})
 ok((await read('distReceivables',foreignDebtId)).balance===10,'distribuidor puede cobrar una deuda originada por otra ruta')
 ok(foreignCollection.result.routeId===route&&foreignCollection.result.originRouteId==='otra-ruta','cobro cruzado entra a la caja del cobrador y conserva la ruta original')
 const validPhoto='data:image/jpeg;base64,/9j/2Q=='
 await setDoc(doc(adminClient,'restaurants','sanjose','distProducts',pid2),{photoDataUrl:validPhoto},{merge:true});checks++
 await assertFails(setDoc(doc(adminClient,'restaurants','sanjose','distProducts',pid2),{photoDataUrl:'data:image/png;base64,AAAA'},{merge:true}));checks++
 await assertFails(setDoc(doc(adminClient,'restaurants','sanjose','distProducts',pid2),{photoDataUrl:`data:image/jpeg;base64,${'A'.repeat(150001)}`},{merge:true}));checks++
 const customerId=`${prefix}-ci`,ci=String(Date.now()).slice(-11),createdAt=new Date().toISOString()
 const customerData={id:customerId,restaurantId:'sanjose',name:'Cliente CI',identityNumber:ci,customerCode:ci,createdAt,createdBy:seller}
 const batch=writeBatch(client);batch.set(doc(client,'restaurants','sanjose','distCustomers',customerId),customerData);batch.set(doc(client,'restaurants','sanjose','distCustomerIdentities',ci),{restaurantId:'sanjose',identityNumber:ci,customerId});await batch.commit();checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distCustomers',`${customerId}-duplicate`),{...customerData,id:`${customerId}-duplicate`}));checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distCustomers',customerId),{customerCode:'OTRO'},{merge:true}));checks++
 await assertFails(setDoc(doc(client,'restaurants','sanjose','distCustomers',customerId),{photoDataUrl:'x'.repeat(130001)},{merge:true}));checks++
 const signIn=async(email,password)=>{const response=await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});return {response,data:await response.json()}}
 const adminSignIn=await signIn(`${prefix}-admin@example.test`,'Inicial123')
 const passwordCall=await fetch('http://127.0.0.1:5001/demo-pachax-audit/us-central1/changeSanJoseMemberPassword',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${adminSignIn.data.idToken}`},body:JSON.stringify({data:{uid:passwordTarget,password:'NuevaClave123'}})})
 ok(passwordCall.ok,'Administración puede cambiar directamente la contraseña de otro usuario')
 const targetSignIn=await signIn(`${prefix}-target@example.test`,'NuevaClave123')
 ok(targetSignIn.response.ok,'la nueva contraseña permite iniciar sesión')

 const support=`${prefix}-support`
 await adminAuth.createUser({uid:support,email:`${prefix}-support@example.test`,password:'Soporte123'})
 await root.collection('members').doc(support).set({uid:support,email:`${prefix}-support@example.test`,displayName:'QA soporte',role:'support',active:true,createdAt:new Date().toISOString(),routeId:'',warehouseId:'central'})
 const supportClient=env.authenticatedContext(support).firestore()
 await assertFails(getDocs(collection(supportClient,'restaurants','sanjose','distSales')));checks++
 await assertFails(getDocs(collection(supportClient,'restaurants','sanjose','distCustomers')));checks++
 await assertFails(getDocs(collection(supportClient,'restaurants','sanjose','distProducts')));checks++
 const supportSettings={restaurantId:'sanjose',companyName:'Embutidos San José',taxId:'123',address:'QA',phone:'70000000',receiptHeader:'SAN JOSE',receiptFooter:'Gracias',expiryAlertDays:14,creditBlockDays:7,requireQrVerification:true,defaultPaperWidth:'80mm',updatedAt:new Date().toISOString(),updatedBy:support}
 await setDoc(doc(supportClient,'restaurants','sanjose','supportConfig','main'),supportSettings);checks++
 ok((await getDoc(doc(supportClient,'restaurants','sanjose','supportConfig','main'))).data().creditBlockDays===7,'Soporte solo puede leer y guardar configuración técnica')
 const warehouseClient=env.authenticatedContext(warehouse).firestore()
 for (const [role, roleClient] of [['Administración', adminClient], ['Almacén', warehouseClient], ['Distribuidor', client]]) {
  const settingsQuery=await getDocs(collection(roleClient,'restaurants','sanjose','supportConfig'))
  ok(settingsQuery.docs.some(entry=>entry.id==='main'),`${role} puede suscribirse a la configuración operativa`)
 }
 const supportRequest={auth:{uid:support,token:{auth_time:Math.floor(Date.now()/1000)}},data:{}}
 const preview=await prepareCleanDelivery(db,supportRequest)
 ok(preview.totalDocuments>0&&preview.counts.distSales>0,'entrega limpia muestra conteo sin devolver datos comerciales')
 const reset=await executeCleanDelivery(db,{...supportRequest,data:{requestId:preview.requestId,phrase:'LIMPIAR EMBUTIDOS SAN JOSE',acknowledgement:true}})
 ok(reset.deletedDocuments>0&&(await root.collection('distSales').get()).empty,'entrega limpia respalda y elimina los datos operativos')
 ok((await root.collection('distProducts').doc(pid).get()).exists&&(await root.collection('members').doc(support).get()).exists&&(await root.collection('distWarehouses').doc(wh).get()).exists,'entrega limpia conserva productos, usuarios y almacenes')
 const backup=await root.collection('maintenanceBackups').doc(reset.backupId).get()
 ok(backup.data().status==='complete'&&backup.data().documentCount>0,'respaldo restringido queda completo antes de finalizar la limpieza')
 fs.writeFileSync('docs/qa-san-jose/server-operations-result.json',JSON.stringify({passed:true,checks,at:new Date().toISOString()},null,2))
 console.log(`${checks} comprobaciones aprobadas`)
}finally{await env.cleanup()}
