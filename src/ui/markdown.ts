import { marked, type Token, type Tokens } from 'marked'
import { displayWidth, graphemes } from './display-width.js'

export type SegmentTone = 'text' | 'muted' | 'accent' | 'code' | 'link' | 'add' | 'delete'

export interface StyledSegment {
  readonly text: string
  readonly tone: SegmentTone
  readonly bold?: boolean
  readonly italic?: boolean
  readonly strike?: boolean
}

export interface StyledLine {
  readonly kind: 'text' | 'code' | 'rule' | 'table'
  readonly segments: readonly StyledSegment[]
}

function segment(text: string, tone: SegmentTone = 'text', style: Partial<StyledSegment> = {}): StyledSegment {
  return { text, tone, ...style }
}

function inline(tokens: readonly Token[] | undefined, style: Partial<StyledSegment> = {}): StyledSegment[] {
  if (tokens === undefined) return []
  return tokens.flatMap((token): StyledSegment[] => {
    switch (token.type) {
      case 'strong': return inline(token.tokens, { ...style, bold: true })
      case 'em': return inline(token.tokens, { ...style, italic: true })
      case 'del': return inline(token.tokens, { ...style, strike: true })
      case 'codespan': return [segment(token.text, 'code', style)]
      case 'link': return [...inline(token.tokens, { ...style, bold: true }), segment(` <${token.href}>`, 'link')]
      case 'image': return [segment(`[image: ${token.text || token.href}]`, 'muted', style)]
      case 'br': return [segment('\n', 'text', style)]
      case 'text': return token.tokens === undefined ? [segment(token.text, 'text', style)] : inline(token.tokens, style)
      case 'escape': return [segment(token.text, 'text', style)]
      default: return 'tokens' in token && Array.isArray(token.tokens) ? inline(token.tokens, style) : [segment('text' in token ? String(token.text) : token.raw, 'text', style)]
    }
  })
}

function wrap(segments: readonly StyledSegment[], width: number, prefix = ''): StyledLine[] {
  const limit = Math.max(4, width)
  const lines: StyledSegment[][] = [[]]
  let used = 0
  const push = (value: StyledSegment): void => {
    const current = lines.at(-1)!
    const previous = current.at(-1)
    if (previous !== undefined && previous.tone === value.tone && previous.bold === value.bold
      && previous.italic === value.italic && previous.strike === value.strike) {
      current[current.length - 1] = { ...previous, text: previous.text + value.text }
    } else current.push(value)
  }
  if (prefix !== '') { push(segment(prefix, 'muted')); used = displayWidth(prefix) }
  for (const source of segments) {
    for (const unit of graphemes(source.text)) {
      if (unit === '\n') {
        lines.push([])
        used = 0
        if (prefix !== '') { push(segment(' '.repeat(displayWidth(prefix)), 'muted')); used = displayWidth(prefix) }
        continue
      }
      const cells = displayWidth(unit)
      if (used > 0 && used + cells > limit) {
        lines.push([])
        used = 0
        if (prefix !== '') { push(segment(' '.repeat(displayWidth(prefix)), 'muted')); used = displayWidth(prefix) }
      }
      push({ ...source, text: unit })
      used += cells
    }
  }
  return lines.map(parts => ({ kind: 'text', segments: parts }))
}

function blocks(tokens: readonly Token[], width: number, quotePrefix = ''): StyledLine[] {
  const output: StyledLine[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        if (output.length > 0 && output.at(-1)!.segments.length > 0) output.push({ kind: 'text', segments: [] })
        break
      case 'heading':
        output.push(...wrap([segment(`${'#'.repeat(token.depth)} `, 'accent', { bold: true }), ...inline(token.tokens, { bold: true })], width, quotePrefix))
        break
      case 'paragraph':
      case 'text':
        output.push(...wrap(inline(token.tokens ?? [{ type: 'text', raw: token.raw, text: token.text }]), width, quotePrefix))
        break
      case 'code': {
        output.push({ kind: 'code', segments: [segment(`┌─ ${token.lang || 'code'}`, 'muted')] })
        for (const line of token.text.split('\n')) output.push(...wrap([segment(line, 'code')], width, '│ ').map(item => ({ ...item, kind: 'code' as const })))
        output.push({ kind: 'code', segments: [segment('└─', 'muted')] })
        break
      }
      case 'blockquote':
        output.push(...blocks(token.tokens ?? [], Math.max(4, width - 2), `${quotePrefix}│ `))
        break
      case 'list': {
        const list = token as Tokens.List
        list.items.forEach((item: Tokens.ListItem, index: number) => {
          const marker = list.ordered ? `${numberStart(list.start, index)}. ` : item.task ? `${item.checked ? '[x]' : '[ ]'} ` : '• '
          output.push(...wrap(inline(item.tokens), width, quotePrefix + marker))
        })
        break
      }
      case 'table': {
        const table = token as Tokens.Table
        const rows = [table.header, ...table.rows]
        rows.forEach((row, index) => {
          const cells = row.map((cell: Tokens.TableCell) => cell.text.replaceAll(/\s+/g, ' ').trim())
          const label = index === 0 ? cells.join(' │ ') : cells.map((cell: string, cellIndex: number) => `${table.header[cellIndex]?.text ?? cellIndex + 1}: ${cell}`).join(' · ')
          output.push(...wrap([segment(label, index === 0 ? 'accent' : 'text', { bold: index === 0 })], width, quotePrefix).map(line => ({ ...line, kind: 'table' as const })))
        })
        break
      }
      case 'hr':
        output.push({ kind: 'rule', segments: [segment('─'.repeat(Math.max(1, width)), 'muted')] })
        break
      case 'html':
        output.push(...wrap([segment('[html] ', 'muted'), segment(token.text.replaceAll(/\s+/g, ' ').trim(), 'code')], width, quotePrefix))
        break
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) output.push(...blocks(token.tokens, width, quotePrefix))
        else if (token.raw.trim() !== '') output.push(...wrap([segment(token.raw.trim(), 'text')], width, quotePrefix))
    }
  }
  return output
}

function numberStart(start: number | '', index: number): number {
  return (typeof start === 'number' ? start : 1) + index
}

export function markdownToLines(source: string, width: number): StyledLine[] {
  if (source === '') return []
  return blocks(marked.lexer(source, { gfm: true, breaks: false }), width)
}

export function plainStyledText(line: StyledLine): string {
  return line.segments.map(part => part.text).join('')
}
