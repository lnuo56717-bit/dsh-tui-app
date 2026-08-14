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
