import stringWidth from 'string-width'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(item => item.segment)
}

export function displayWidth(text: string): number {
  return stringWidth(text)
}

export function takeCells(text: string, cells: number): { head: string; tail: string; width: number } {
  if (cells <= 0) return { head: '', tail: text, width: 0 }
  let head = ''
  let width = 0
  const units = graphemes(text)
  let index = 0
  for (; index < units.length; index += 1) {
    const unit = units[index]!
    const next = stringWidth(unit)
    if (width + next > cells) break
    head += unit
    width += next
  }
  return { head, tail: units.slice(index).join(''), width }
}

export function cursorCell(text: string, graphemeOffset: number): number {
  return stringWidth(graphemes(text).slice(0, Math.max(0, graphemeOffset)).join(''))
}

export function middleEllipsis(text: string, cells: number): string {
  if (cells <= 0) return ''
  if (displayWidth(text) <= cells) return text
  if (cells === 1) return '…'
  const available = cells - 1
  const leftCells = Math.ceil(available / 2)
  const rightCells = Math.floor(available / 2)
  const head = takeCells(text, leftCells).head
  const units = graphemes(text)
  let tail = ''
  let width = 0
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!
    const next = displayWidth(unit)
    if (width + next > rightCells) break
    tail = unit + tail
    width += next
  }
  return `${head}…${tail}`
}
