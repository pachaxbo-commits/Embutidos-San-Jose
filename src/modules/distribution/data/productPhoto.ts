export async function prepareProductPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
    throw new Error('Selecciona una imagen de hasta 12 MB.')
  }
  const loaded = await loadProductImage(file)
  try {
    const scale = Math.min(1, 640 / Math.max(loaded.width, loaded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(loaded.width * scale))
    canvas.height = Math.max(1, Math.round(loaded.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo procesar la fotografía.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(loaded.source, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.78, 0.6, 0.42]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= 150000) return data
    }
    throw new Error('La fotografía tiene demasiado detalle. Selecciona otra imagen.')
  } finally {
    loaded.release()
  }
}

interface LoadedProductImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/**
 * Android WebView moderno incluye createImageBitmap, pero algunos celulares y
 * tablets antiguos no. El segundo camino usa Image, disponible en esos equipos.
 */
async function loadProductImage(file: File): Promise<LoadedProductImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Continúa con el decodificador compatible del navegador.
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('No se pudo leer la fotografía seleccionada.'))
      image.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}
