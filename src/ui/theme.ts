import type { ColorMode, ThemeName } from '../startup.js'

export type ThemeColor = string
export type ColorTier = Exclude<ColorMode, 'auto'>

export interface Theme {
  readonly name: 'abyss' | 'pearl'
  readonly tier: ColorTier
  readonly monochrome: boolean
  readonly canvas: ThemeColor
  readonly panel: ThemeColor
  readonly border: ThemeColor
  readonly primary: ThemeColor
  readonly accent: ThemeColor
  readonly text: ThemeColor
  readonly muted: ThemeColor
  readonly user: ThemeColor
  readonly success: ThemeColor
  readonly danger: ThemeColor
  readonly warning: ThemeColor
}

type Palette = Omit<Theme, 'name' | 'tier' | 'monochrome'>

const TRUECOLOR: Record<'abyss' | 'pearl', Palette> = {
  abyss: {
    canvas: '#06111F', panel: '#0A192A', border: '#29445D', primary: '#178BFF', accent: '#43C6E8',
    text: '#D7E5F2', muted: '#6F879D', user: '#74AFFF', success: '#5ED6B3', danger: '#FF7A6E', warning: '#F6C85F',
  },
  pearl: {
    canvas: '#F4F7FA', panel: '#EAF0F5', border: '#9AAABA', primary: '#006FD6', accent: '#087F9C',
    text: '#172435', muted: '#647489', user: '#005EB8', success: '#087F69', danger: '#C83B32', warning: '#8B6508',
  },
}

const ANSI256: Record<'abyss' | 'pearl', Palette> = {
  abyss: {
    canvas: 'none', panel: 'none', border: 'ansi256(24)', primary: 'ansi256(33)', accent: 'ansi256(33)',
    text: 'ansi256(252)', muted: 'ansi256(66)', user: 'ansi256(33)', success: 'ansi256(79)', danger: 'ansi256(210)', warning: 'ansi256(221)',
  },
  pearl: {
    canvas: 'none', panel: 'none', border: 'ansi256(244)', primary: 'ansi256(33)', accent: 'ansi256(31)',
    text: 'ansi256(235)', muted: 'ansi256(244)', user: 'ansi256(32)', success: 'ansi256(29)', danger: 'ansi256(160)', warning: 'ansi256(136)',
  },
}

const ANSI16: Record<'abyss' | 'pearl', Palette> = {
  abyss: {
    canvas: 'none', panel: 'none', border: 'blue', primary: 'blueBright', accent: 'cyan',
    text: 'white', muted: 'gray', user: 'blueBright', success: 'green', danger: 'red', warning: 'yellow',
  },
  pearl: {
    canvas: 'none', panel: 'none', border: 'gray', primary: 'blue', accent: 'cyan',
    text: 'black', muted: 'gray', user: 'blue', success: 'green', danger: 'red', warning: 'yellow',
  },
}

const MONO: Palette = {
  canvas: 'none', panel: 'none', border: 'none', primary: 'none', accent: 'none',
  text: 'none', muted: 'none', user: 'none', success: 'none', danger: 'none', warning: 'none',
}

export function detectColorTier(env: NodeJS.ProcessEnv = process.env): ColorTier {
  if (env.NO_COLOR !== undefined) return 'mono'
  if (/truecolor|24bit/iu.test(env.COLORTERM ?? '')) return 'truecolor'
  if (/256color/iu.test(env.TERM ?? '')) return '256'
  return '16'
}

export function resolveTheme(name: ThemeName, color: ColorMode, env: NodeJS.ProcessEnv = process.env): Theme {
  const selected = name === 'pearl' ? 'pearl' : 'abyss'
  const tier = env.NO_COLOR !== undefined ? 'mono' : color === 'auto' ? detectColorTier(env) : color
  const palette = tier === 'truecolor' ? TRUECOLOR[selected]
    : tier === '256' ? ANSI256[selected]
      : tier === '16' ? ANSI16[selected] : MONO
  return { name: selected, tier, monochrome: tier === 'mono', ...palette }
}
