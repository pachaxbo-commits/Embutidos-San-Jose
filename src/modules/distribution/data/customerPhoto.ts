export async function prepareCustomerPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) throw new Error('Selecciona una imagen de hasta 12 MB.')
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 480 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo procesar la fotografía.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.75, 0.55, 0.35]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= 130000) return data
    }
    throw new Error('La fotografía es demasiado grande. Selecciona otra imagen.')
  } finally { image.close() }
}
