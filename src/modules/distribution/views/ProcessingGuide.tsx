export type ProcessingGuideTopic = 'new' | 'materials' | 'reservations' | 'review' | 'evidence' | 'repack' | 'history'

const GUIDES: Record<ProcessingGuideTopic, { title: string; steps: string[] }> = {
  new: {
    title: 'Nueva elaboración',
    steps: [
      'Elige un producto a granel medido en kg y uno o varios lotes elegibles. Registra los kg realmente retirados de cada lote; el servidor vuelve a validar existencias y vencimiento.',
      'Para cada destino registra el peso neto real medido en gramos, la presentación y sus datos de lote. El peso nominal describe la presentación y no reemplaza la balanza.',
      'La suma de los pesos de origen y de todos los destinos debe coincidir exactamente. No se generan promedios desde el catálogo para completar pesos faltantes.',
      'Al confirmar, el servidor registra la elaboración y sus movimientos una sola vez. Los lotes terminados quedan pendientes de liberación. Administración con autorización vigente de Calidad puede revisar el lote y autorizar su uso comercial desde el detalle del historial; las reservas y la cuarentena impiden liberarlo.',
    ],
  },
  materials: {
    title: 'Materiales adicionales (opcional)',
    steps: [
      'Registra bolsas, etiquetas u otros materiales solo si los necesitas. Anota unidades usadas y dañadas por separado: una bolsa rota no significa que se haya perdido alimento.',
      'El costo y la referencia a un egreso existente son informativos. No vuelvas a cargar aquí un gasto ya contabilizado; esta pantalla no cambia Egresos ni Resultado.',
      'Si no tienes el dato, deja el costo vacío. Los materiales no reemplazan el pesaje ni la conciliación de masa.',
    ],
  },
  reservations: {
    title: 'Mercadería reservada',
    steps: [
      'Una reserva inmoviliza parte de la existencia para revisión, reenvasado o cortesía; esa cantidad deja de estar disponible para venta o despacho.',
      'Revisa cantidad comercial, peso histórico si existe, costo y motivo. Un peso desconocido se conserva como desconocido, no se estima con el peso nominal.',
      'Las reservas y liberaciones confirmadas quedan en el historial. Registra solo cantidades respaldadas por la evidencia física disponible.',
    ],
  },
  review: {
    title: 'Revisión de producto',
    steps: [
      'Almacén identifica producto y lote, describe el envase y el alimento, registra observaciones y mide el peso neto cuando corresponda. Adjunta evidencia vinculada al caso.',
      'Registrar una observación no libera ni descuenta inventario. Mantén separado el alimento apto aparente, el producto partido, el caso incierto y el producto no apto.',
      'Las decisiones de calidad que lo exigen requieren una autorización vigente de Calidad. Administración no sustituye automáticamente esa autorización y nadie puede aprobarse a sí mismo.',
      'Una pérdida, descarte o ajuste económico permanece pendiente hasta contar con evidencia y aprobación autorizada. No conviertas una observación en una venta o liberación.',
    ],
  },
  evidence: {
    title: 'Adjuntar evidencia',
    steps: [
      'Adjunta una fotografía JPG/PNG o un PDF de hasta 15 MB. En un teléfono, el selector de archivos puede ofrecer cámara o galería según el navegador y los permisos del dispositivo.',
      'La carga se asocia a lote, reserva, ubicación y revisión. El servidor verifica tipo, tamaño, huella del archivo y versión de la revisión antes de aceptarla.',
      'Espera la confirmación de carga. Si falla la conexión, usa Reintentar en el mismo formulario; no crees otra revisión para volver a subir el mismo archivo.',
    ],
  },
  repack: {
    title: 'Reenvasado',
    steps: [
      'Solo elige una reserva con revisión autorizada para reenvasado y evidencia verificada. Una revisión pendiente o un producto declarado no apto no habilitan esta operación.',
      'Registra cantidad abierta y peso neto recuperable medido. Ingresa cada nueva presentación y su peso real; las salidas deben conciliar con la entrada medida.',
      'Se conservan el costo histórico y las fechas originales; el vencimiento no puede extenderse. Materiales de empaque son informativos y no duplican Egresos.',
      'La confirmación productiva está sujeta a controles del servidor y a su autorización de despliegue. Si el servidor la bloquea, conserva la reserva y solicita revisión; no intentes vender el producto.',
    ],
  },
  history: {
    title: 'Historial y trazabilidad',
    steps: [
      'Consulta elaboraciones, revisiones y reenvasados confirmados desde sus pestañas. El historial se carga por páginas; usa Cargar más para continuar.',
      'En una elaboración puedes revisar lotes de origen, aportes, destinos, pesos medidos, costos históricos, responsable, materiales y movimientos vinculados.',
      'Un dato que no fue pesado se muestra como no medido o desconocido. El historial documenta lo ocurrido; no crea movimientos adicionales en inventario.',
    ],
  },
}

export function ProcessingGuide({ topic, onStart }: { topic: ProcessingGuideTopic; onStart?: () => void }) {
  const guide = GUIDES[topic]
  if (topic === 'new' && onStart) return <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-2.5">
    <p className="text-xs font-semibold text-sky-950">Recorra los campos de una nueva elaboración, paso a paso.</p>
    <button type="button" onClick={onStart} className="min-h-10 rounded-xl bg-sky-700 px-4 text-xs font-extrabold text-white">Tutorial</button>
  </div>
  return (
    <details className="mb-3 min-w-0 rounded-xl border border-sky-200 bg-sky-50/70 p-2.5 text-sky-950">
      <summary className="min-h-9 cursor-pointer list-inside list-disc text-xs font-extrabold">Tutorial · {guide.title}</summary>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs leading-relaxed">
        {guide.steps.map(step => <li key={step}>{step}</li>)}
      </ol>
    </details>
  )
}
