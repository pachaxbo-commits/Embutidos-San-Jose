export class ProcessingReportLimitError extends Error {
  constructor(maxRows: number) {
    super(`El período supera el límite de ${maxRows} registros. Selecciona un período menor; el informe está incompleto y no se puede exportar ni imprimir.`)
    this.name = 'ProcessingReportLimitError'
  }
}

/** Return only complete results. A failure or stale request never yields a partial report. */
export async function collectProcessingReportPages<Row extends { id: string }, Cursor>(
  load: (cursor: Cursor | null) => Promise<{ rows: Row[]; cursor: Cursor | null; hasMore: boolean }>,
  current: () => boolean,
  maxRows = 10000,
): Promise<Row[] | null> {
  let cursor: Cursor | null = null
  const records = new Map<string, Row>()
  for (let pageNumber = 0; ; pageNumber++) {
    if (!current()) return null
    const page = await load(cursor)
    if (!current()) return null
    const before = records.size
    for (const row of page.rows) records.set(row.id, row)
    if (records.size > maxRows || pageNumber > Math.ceil(maxRows / 50)) throw new ProcessingReportLimitError(maxRows)
    if (!page.hasMore) return [...records.values()]
    if (!page.cursor || page.cursor === cursor || before === records.size) throw new Error('No se pudo completar la paginación. Actualiza el informe.')
    cursor = page.cursor
  }
}
