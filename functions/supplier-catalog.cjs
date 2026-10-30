async function listDistributorPurchaseSuppliers(db, uid) {
  if (!uid) throw Object.assign(new Error("Inicia sesión para continuar."), { code: "unauthenticated" });
  const root = db.collection("restaurants").doc("sanjose");
  const member = await root.collection("members").doc(uid).get();
  if (!member.exists || member.data()?.active !== true || member.data()?.role !== "distributor" || !member.data()?.routeId)
    throw Object.assign(new Error("Solo distribuidores activos con ruta asignada pueden consultar proveedores para compras."), { code: "permission-denied" });
  const suppliers = await root.collection("distSuppliers").where("active", "==", true).get();
  return suppliers.docs
    .map(document => ({ id: document.id, name: String(document.data()?.name || "") }))
    .filter(supplier => supplier.name.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

module.exports = { listDistributorPurchaseSuppliers };
