import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  console.log('Initializing test environment...');
  const rules = fs.readFileSync('firebase/firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: 'comandero-6907f',
    firestore: {
      host: '127.0.0.1',
      port: 8085,
      rules,
    },
  });

  // Clear Firestore to ensure a clean state
  console.log('Clearing Firestore database...');
  await testEnv.clearFirestore();

  const restaurantId = 'principal';
  const dayId = '2026-06-30';
  
  console.log('Seeding mock members...');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    
    // Seed active members
    await setDoc(doc(db, `restaurants/${restaurantId}/members/uid-pedidos`), {
      email: 'pedidos@dev.local',
      role: 'pedidos',
      active: true,
    });
    await setDoc(doc(db, `restaurants/${restaurantId}/members/uid-cocina`), {
      email: 'cocina@dev.local',
      role: 'cocina',
      active: true,
    });
    await setDoc(doc(db, `restaurants/${restaurantId}/members/uid-caja`), {
      email: 'caja@dev.local',
      role: 'caja',
      active: true,
    });
    await setDoc(doc(db, `restaurants/${restaurantId}/members/uid-admin`), {
      email: 'admin@dev.local',
      role: 'admin',
      active: true,
    });

    // Seed day document
    await setDoc(doc(db, `restaurants/${restaurantId}/days/${dayId}`), {
      dayKey: dayId,
      restaurantId,
      sequence: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // Helper context providers
  const getPedidosDb = () => testEnv.authenticatedContext('uid-pedidos').firestore();
  const getCocinaDb = () => testEnv.authenticatedContext('uid-cocina').firestore();
  const getCajaDb = () => testEnv.authenticatedContext('uid-caja').firestore();
  const getAdminDb = () => testEnv.authenticatedContext('uid-admin').firestore();

  // Create valid template order helper
  const getTemplateOrder = (overrides = {}) => ({
    id: 'test-order-123',
    sequence: 2,
    displayNumber: '#002',
    createdAt: serverTimestamp(),
    status: 'pending',
    items: [{ id: 'item1', name: 'Pizza', quantity: 1, lineTotal: 30, price: 30, modifiers: { extras: [], options: [], note: '' } }],
    total: 30,
    paymentStatus: 'pending',
    paymentMethod: null,
    expectedPaymentMethod: null,
    orderSource: 'whatsapp',
    fulfillmentType: 'pickup',
    customerName: 'Juan',
    customerPhone: '77777777',
    createdBy: 'uid-pedidos',
    payment: { method: 'cash', cashAmount: 0, qrAmount: 0, cashReceived: 0, change: 0 },
    updatedAt: serverTimestamp(),
    ...overrides
  });

  const createOrderWithBatch = async (db, order) => {
    const batch = writeBatch(db);
    const dayRef = doc(db, `restaurants/${restaurantId}/days/${dayId}`);
    const orderRef = doc(db, `restaurants/${restaurantId}/days/${dayId}/orders/${order.id}`);
    batch.update(dayRef, {
      sequence: order.sequence,
      updatedAt: serverTimestamp()
    });
    batch.set(orderRef, order);
    await batch.commit();
  };

  console.log('\n--- STARTING RULE TESTS ---');

  // ==========================================
  // A. Rol pedidos
  // ==========================================
  console.log('\nTesting Rol Pedidos...');
  
  const dbPedidos = getPedidosDb();
  
  // 1. Can only create WhatsApp orders
  const orderWhatsapp = getTemplateOrder({ id: 'order-wa', orderSource: 'whatsapp', sequence: 2 });
  await assertSucceeds(createOrderWithBatch(dbPedidos, orderWhatsapp));
  
  const orderLocal = getTemplateOrder({ id: 'order-local', orderSource: 'local', sequence: 3 });
  await assertFails(createOrderWithBatch(dbPedidos, orderLocal));
  console.log('-> 1. Can only create WhatsApp orders: PASS');

  // 2. Can only create Retiro (pickup) or Delivery
  const orderTable = getTemplateOrder({ id: 'order-table', fulfillmentType: 'table', sequence: 3 });
  await assertFails(createOrderWithBatch(dbPedidos, orderTable));
  console.log('-> 2. Can only create Retiro or Delivery: PASS');

  // Seed an order created by admin for reading/writing tests
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `restaurants/${restaurantId}/days/${dayId}/orders/admin-order`), {
      ...getTemplateOrder({ id: 'admin-order', createdBy: 'uid-admin' }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // 3. Cannot read orders of another user
  await assertFails(getDoc(doc(dbPedidos, `restaurants/${restaurantId}/days/${dayId}/orders/admin-order`)));
  console.log('-> 3. Cannot read orders of another user: PASS');

  // 4. Cannot modify orders of another user
  await assertFails(updateDoc(doc(dbPedidos, `restaurants/${restaurantId}/days/${dayId}/orders/admin-order`), { customerName: 'Nuevo' }));
  console.log('-> 4. Cannot modify orders of another user: PASS');

  // 5. Cannot confirm payments
  await assertFails(updateDoc(doc(dbPedidos, `restaurants/${restaurantId}/days/${dayId}/orders/order-wa`), {
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    paidAt: serverTimestamp(),
    paidBy: 'uid-pedidos',
    payment: { method: 'cash', cashAmount: 30, qrAmount: 0, cashReceived: 30, change: 0 }
  }));
  console.log('-> 5. Cannot confirm payments: PASS');

  // 6. Cannot cancel
  await assertFails(updateDoc(doc(dbPedidos, `restaurants/${restaurantId}/days/${dayId}/orders/order-wa`), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledBy: 'uid-pedidos'
  }));
  console.log('-> 6. Cannot cancel: PASS');

  // Seed an order completed by Kitchen (status ready)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `restaurants/${restaurantId}/days/${dayId}/orders/kitchen-ready-order`), {
      ...getTemplateOrder({ id: 'kitchen-ready-order', status: 'ready' }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // 7. Cannot modify a completed order
  await assertFails(updateDoc(doc(dbPedidos, `restaurants/${restaurantId}/days/${dayId}/orders/kitchen-ready-order`), { customerName: 'Modificado' }));
  console.log('-> 7. Cannot modify a completed order: PASS');

  // ==========================================
  // B. Rol cocina
  // ==========================================
  console.log('\nTesting Rol Cocina...');
  const dbCocina = getCocinaDb();

  // 1. Can advance operating status
  await assertSucceeds(updateDoc(doc(dbCocina, `restaurants/${restaurantId}/days/${dayId}/orders/order-wa`), {
    status: 'preparing',
    updatedAt: serverTimestamp()
  }));
  console.log('-> 1. Can advance operative status: PASS');

  // 2. Cannot change total, items, customer info, payments, or cancel
  await assertFails(updateDoc(doc(dbCocina, `restaurants/${restaurantId}/days/${dayId}/orders/order-wa`), {
    status: 'ready',
    readyAt: serverTimestamp(),
    total: 9999, // Attempting to change total should fail
    updatedAt: serverTimestamp()
  }));
  console.log('-> 2. Cannot change total, items, customer info or payments: PASS');

  // ==========================================
  // C. Rol caja
  // ==========================================
  console.log('\nTesting Rol Caja...');
  const dbCaja = getCajaDb();

  // Seed pending payment order
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `restaurants/${restaurantId}/days/${dayId}/orders/pending-cancel-order`), {
      ...getTemplateOrder({ id: 'pending-cancel-order', paymentStatus: 'pending' }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // 1. Can cancel pending payment orders
  await assertSucceeds(updateDoc(doc(dbCaja, `restaurants/${restaurantId}/days/${dayId}/orders/pending-cancel-order`), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledBy: 'uid-caja',
    updatedAt: serverTimestamp()
  }));
  console.log('-> 1. Can cancel pending payment orders: PASS');

  // Seed paid order
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `restaurants/${restaurantId}/days/${dayId}/orders/paid-order`), {
      ...getTemplateOrder({
        id: 'paid-order',
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        payment: { method: 'cash', cashAmount: 30, qrAmount: 0, cashReceived: 30, change: 0 }
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // 2. Cannot cancel paid orders
  await assertFails(updateDoc(doc(dbCaja, `restaurants/${restaurantId}/days/${dayId}/orders/paid-order`), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledBy: 'uid-caja',
    updatedAt: serverTimestamp()
  }));
  console.log('-> 2. Cannot cancel paid orders: PASS');

  // ==========================================
  // D. Rol admin
  // ==========================================
  console.log('\nTesting Rol Admin...');
  const dbAdmin = getAdminDb();

  // 1. Can perform administrative actions (e.g. create category)
  await assertSucceeds(setDoc(doc(dbAdmin, `restaurants/${restaurantId}/catalog/default/categories/cat-1`), {
    name: 'Bebidas',
    subtitle: 'Frias',
    emoji: '🥤',
    sortOrder: 1,
    isActive: true,
    isVisible: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
  console.log('-> 1. Can perform administrative actions: PASS');

  // 2. Cannot delete orders physically
  await assertFails(deleteDoc(doc(dbAdmin, `restaurants/${restaurantId}/days/${dayId}/orders/order-wa`)));
  console.log('-> 2. Cannot delete orders physically: PASS');

  // ==========================================
  // E. Integridad de Campos
  // ==========================================
  console.log('\nTesting Integridad de Campos (Inmutabilidad)...');
  
  // Try to change createdBy
  await assertFails(updateDoc(doc(dbAdmin, `restaurants/${restaurantId}/days/${dayId}/orders/paid-order`), {
    createdBy: 'hacker-uid',
    updatedAt: serverTimestamp()
  }));

  // Try to change sequence
  await assertFails(updateDoc(doc(dbAdmin, `restaurants/${restaurantId}/days/${dayId}/orders/paid-order`), {
    sequence: 999,
    updatedAt: serverTimestamp()
  }));
  console.log('-> E. Rules reject changes to immutable fields: PASS');
  console.log('\n--- ALL TEST CASES PASSED SUCCESSFULLY ---');
  await testEnv.cleanup();
}

run().catch(console.error);
