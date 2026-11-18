function routeCollectionsForDispatch(dispatch, dispatches, rows, through) {
  const peers = dispatches.filter(row => row.routeId === dispatch.routeId &&
    row.distributorUid === dispatch.distributorUid && row.dayKey === dispatch.dayKey && row.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return rows.filter(row => {
    if (!dispatch.distributorUid || row.routeId !== dispatch.routeId || row.collectedByUid !== dispatch.distributorUid ||
      row.dayKey !== dispatch.dayKey || !row.createdAt || row.createdAt > through || row.voided || row.voidedAt) return false;
    if (row.dispatchId) return row.dispatchId === dispatch.id;
    // A legacy receipt belongs to the latest opening before collection
    // unless that dispatch had already finished, in which case use the next.
    const previous = peers.findLast(peer => peer.createdAt <= row.createdAt);
    const firstClose = previous?.firstClosedAt || previous?.closedAt;
    const owner = previous && (!firstClose || row.createdAt <= firstClose)
      ? previous : peers.find(peer => peer.createdAt > row.createdAt);
    return owner?.id === dispatch.id;
  });
}
module.exports = { routeCollectionsForDispatch };
