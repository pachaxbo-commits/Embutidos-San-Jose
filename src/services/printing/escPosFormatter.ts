export interface EscPosOptions {
  columnsPerLine: number
  paperWidth: '58mm' | '80mm'
  feedLinesEnd?: number
  cutSequenceHex?: string
  drawerPin?: 'pin2' | 'pin5'
  drawerOnTimeMs?: number
  drawerOffTimeMs?: number
}

// Controlled character transliteration map for ESC/POS thermal printers
const SPECIAL_CHAR_MAP: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  Á: 'A',
  É: 'E',
  Í: 'I',
  Ó: 'O',
  Ú: 'U',
  ñ: 'n',
  Ñ: 'N',
  ü: 'u',
  '¿': '',
  '¡': '',
}

/** Bytes CP850 comprobados con la impresora termica de 80 mm del cliente. */
const CP850_BYTES: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, º: 0xa7, ª: 0xa6,
}

export function transliterateText(text: string): string {
  if (!text) return ''
  return text.replace(/[áéíóúÁÉÍÓÚñÑüÜ¿¡]/g, (ch) => SPECIAL_CHAR_MAP[ch] || ch)
}

export function padLine(left: string, right: string, width: number): string {
  const cleanLeft = transliterateText(left)
  const cleanRight = transliterateText(right)
  const spacesCount = Math.max(1, width - (cleanLeft.length + cleanRight.length))
  return cleanLeft + ' '.repeat(spacesCount) + cleanRight
}

export function centerText(text: string, width: number): string {
  const clean = transliterateText(text)
  if (clean.length >= width) return clean.slice(0, width)
  const leftPadding = Math.floor((width - clean.length) / 2)
  return ' '.repeat(leftPadding) + clean
}

export class EscPosBuilder {
  private bytes: number[] = []

  constructor() {
    this.init()
  }

  init(): this {
    // ESC @ (Initialize printer)
    this.bytes.push(0x1b, 0x40)
    // ESC t 2: selecciona CP850, igual que la configuracion ya probada en BURGUERLAB.
    this.bytes.push(0x1b, 0x74, 0x02)
    return this
  }

  alignLeft(): this {
    this.bytes.push(0x1b, 0x61, 0x00)
    return this
  }

  alignCenter(): this {
    this.bytes.push(0x1b, 0x61, 0x01)
    return this
  }

  alignRight(): this {
    this.bytes.push(0x1b, 0x61, 0x02)
    return this
  }

  bold(enable: boolean): this {
    this.bytes.push(0x1b, 0x45, enable ? 0x01 : 0x00)
    return this
  }

  doubleSize(enable: boolean): this {
    // GS ! n (0x11 = double width & height, 0x00 = normal)
    this.bytes.push(0x1d, 0x21, enable ? 0x11 : 0x00)
    return this
  }

  text(str: string): this {
    for (const character of str) {
      const mapped = CP850_BYTES[character]
      if (mapped !== undefined) {
        this.bytes.push(mapped)
        continue
      }
      const code = character.charCodeAt(0)
      this.bytes.push(code < 128 ? code : 0x20)
    }
    return this
  }

  line(str = ''): this {
    this.text(str)
    this.bytes.push(0x0a)
    return this
  }

  /** Imprime una imagen monocroma usando el comando raster estándar GS v 0. */
  rasterImage(widthPixels: number, heightPixels: number, data: Uint8Array): this {
    const widthBytes = Math.ceil(widthPixels / 8)
    const expectedLength = widthBytes * heightPixels
    if (data.length !== expectedLength) {
      throw new Error(`Imagen ESC/POS inválida: se esperaban ${expectedLength} bytes y llegaron ${data.length}.`)
    }
    this.bytes.push(
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      heightPixels & 0xff, (heightPixels >> 8) & 0xff,
      ...data,
    )
    return this
  }

  separator(width: number, char = '-'): this {
    this.line(char.repeat(width))
    return this
  }

  feed(lines = 3): this {
    this.bytes.push(0x1b, 0x64, lines)
    return this
  }

  cut(fullCut = true): this {
    // La impresora usada por el cliente ya fue validada con GS V 66 0 (corte parcial).
    if (fullCut) this.bytes.push(0x1d, 0x56, 0x00)
    else this.bytes.push(0x1d, 0x56, 0x42, 0x00)
    return this
  }

  kickCashDrawer(pin: 'pin2' | 'pin5' = 'pin2', t1 = 25, t2 = 250): this {
    // ESC p m t1 t2
    const m = pin === 'pin2' ? 0x00 : 0x01
    this.bytes.push(0x1b, 0x70, m, Math.min(255, t1), Math.min(255, t2))
    return this
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}
