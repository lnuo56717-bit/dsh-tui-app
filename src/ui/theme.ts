import type { ColorMode, ThemeName } from '../startup.js'

export interface Theme {
  canvas: string
  panel: string
  border: string
  primary: string
  accent: string
  text: string
  muted: string
  user: string
}

const deepOcean: Theme = {
  canvas: '#07111F',
  panel: '#0B1728',
  border: '#203659',
  primary: '#4C6AFF',
  accent: '#38D6FF',
  text: '#DCE7FF',
  muted: '#7186AA',
  user: '#9FB0FF',
}

const mono: Theme = {
  canvas: '#000000',
  panel: '#000000',
  border: '#777777',
  primary: '#FFFFFF',
  accent: '#FFFFFF',
  text: '#FFFFFF',
  muted: '#AAAAAA',
  user: '#FFFFFF',
}

export function resolveTheme(name: ThemeName, color: ColorMode): Theme {
  return name === 'mono' || color === 'none' ? mono : deepOcean
}
