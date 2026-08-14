import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import React from 'react';
import {Box, Text, render, renderToString} from 'ink';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';

const ENTER_ALT = '\u001B[?1049h';
const LEAVE_ALT = '\u001B[?1049l';
const HIDE_CURSOR = '\u001B[?25l';
const SHOW_CURSOR = '\u001B[?25h';

if (process.argv.includes('--color-child')) {
  const tier = process.argv.at(-1);
  const color = tier === '3' ? '#178BFF' : tier === '2' ? 'ansi256(33)' : 'cyan';
  const frame = renderToString(React.createElement(Text, {color}, 'DeepSeek'));
  process.stdout.write(JSON.stringify(frame));
  process.exit(0);
}

class MemoryOutput extends EventEmitter {
  constructor(columns, rows, colorDepth) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.colorDepth = colorDepth;
    this.isTTY = true;
    this.bytes = '';
  }

  write(chunk) {
    this.bytes += String(chunk);
    return true;
  }

  getColorDepth() {
    return this.colorDepth;
  }

  hasColors(count = 16) {
    return count <= (this.colorDepth >= 24 ? 16_777_216 : this.colorDepth >= 8 ? 256 : 16);
  }
}

class MemoryInput extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.isRaw = false;
  }

  setRawMode(value) {
    this.isRaw = value;
  }

  resume() {}
  pause() {}
  setEncoding() {}
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function inkFrame(columns, colorDepth) {
  const stdout = new MemoryOutput(columns, 20, colorDepth);
  const stdin = new MemoryInput();
  const App = () => React.createElement(
    Box,
    {width: '100%', flexDirection: 'column'},
    React.createElement(Text, {color: '#178BFF'}, '深海 DeepSeek，ＡＢ'),
    React.createElement(Text, null, '宽度校验 / CJK wrap'),
  );
  const instance = render(React.createElement(App), {
    stdout,
    stdin,
    stderr: stdout,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await wait(30);
  const before = stdout.bytes.length;
  stdout.columns = columns + 7;
  stdout.emit('resize');
  await wait(30);
  instance.unmount();
  return {bytes: stdout.bytes, resizeBytes: stdout.bytes.length - before};
}

function alternateScreenProbe() {
  const output = new MemoryOutput(80, 24, 24);
  let caught = false;
  output.write(ENTER_ALT + HIDE_CURSOR);
  try {
    throw new Error('probe');
  } catch {
    caught = true;
  } finally {
    output.write(SHOW_CURSOR + LEAVE_ALT);
  }
  return {
    caught,
    entered: output.bytes.startsWith(ENTER_ALT + HIDE_CURSOR),
    restored: output.bytes.endsWith(SHOW_CURSOR + LEAVE_ALT),
    enterCount: output.bytes.split(ENTER_ALT).length - 1,
    leaveCount: output.bytes.split(LEAVE_ALT).length - 1,
  };
}

function cjkProbe() {
  const sample = '中文 CJK，ＡＢ。';
  const expectedColumns = 16;
  const wrapped = wrapAnsi(sample, 9, {hard: true, trim: false, wordWrap: false});
  const lines = wrapped.split('\n');
  return {
    sample,
    columns: stringWidth(sample),
    expectedColumns,
    cursorColumns: [...sample].map((_, index) => stringWidth([...sample].slice(0, index + 1).join(''))),
    wrapped,
    wrappedLineWidths: lines.map(stringWidth),
    noHalfGlyph: lines.every(line => stringWidth(line) <= 9) && lines.join('') === sample,
  };
}

function fold5kProbe() {
  const events = [];
  for (let seq = 0; seq < 5000; seq += 1) {
    const step = Math.floor(seq / 10);
    events.push({
      seq,
      type: seq % 10 === 0 ? 'tool/call' : seq % 10 === 9 ? 'tool/result' : 'assistant/chunk',
      step,
    });
  }
  events.splice(2500, 0, events[2499]);
  events.splice(3100, 0, {seq: 5001, type: 'future/unknown'});

  const once = () => {
    const seen = new Set();
    const nodes = new Map();
    for (const event of events) {
      if (seen.has(event.seq)) continue;
      seen.add(event.seq);
      const key = event.step ?? event.seq;
      const current = nodes.get(key) ?? {chunks: 0, tool: 'none'};
      if (event.type === 'assistant/chunk') current.chunks += 1;
      else if (event.type === 'tool/call') current.tool = 'running';
      else if (event.type === 'tool/result') current.tool = 'settled';
      else nodes.set(`raw:${event.seq}`, {type: event.type});
      nodes.set(key, current);
    }
    return nodes;
  };

  for (let i = 0; i < 20; i += 1) once();
  const samples = [];
  for (let i = 0; i < 100; i += 1) {
    const start = performance.now();
    once();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    inputEvents: events.length,
    uniqueEvents: new Set(events.map(event => event.seq)).size,
    p50Ms: Number(samples[49].toFixed(3)),
    p95Ms: Number(samples[94].toFixed(3)),
    maxMs: Number(samples.at(-1).toFixed(3)),
    outputNodes: once().size,
  };
}

function colorFrame(level) {
  const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname.slice(1), '--color-child', String(level)], {
    encoding: 'utf8',
    env: {...process.env, FORCE_COLOR: String(level)},
  });
  if (child.status !== 0) throw new Error(child.stderr || `color child exited ${child.status}`);
  return JSON.parse(child.stdout);
}

const frame24 = await inkFrame(25, 24);
const frame8 = await inkFrame(25, 8);
const frame4 = await inkFrame(25, 4);
const color24 = colorFrame(3);
const color8 = colorFrame(2);
const color4 = colorFrame(1);
const result = {
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    terminal: process.env.WT_SESSION ? 'Windows Terminal' : 'non-Windows-Terminal harness',
  },
  alternateScreen: alternateScreenProbe(),
  resize: {
    truecolorBytesAfterResize: frame24.resizeBytes,
    ansi256BytesAfterResize: frame8.resizeBytes,
    repainted: frame24.resizeBytes > 0 && frame8.resizeBytes > 0,
  },
  color: {
    truecolorSequence: /\u001B\[38;2;\d+;\d+;\d+m/.test(color24),
    ansi256Sequence: /\u001B\[38;5;\d+m/.test(color8),
    ansi16Sequence: /\u001B\[(?:3\d|9\d)m/.test(color4),
    truecolorText: stripAnsi(frame24.bytes).includes('深海 DeepSeek，ＡＢ'),
  },
  cjk: cjkProbe(),
  fold5k: fold5kProbe(),
};

console.log(JSON.stringify(result, null, 2));

const failures = [];
if (!result.alternateScreen.restored || result.alternateScreen.enterCount !== result.alternateScreen.leaveCount) failures.push('alternate-screen cleanup');
if (!result.resize.repainted) failures.push('resize repaint');
if (!result.color.truecolorSequence || !result.color.ansi256Sequence || !result.color.ansi16Sequence) failures.push('color downgrade');
if (result.cjk.columns !== result.cjk.expectedColumns || !result.cjk.noHalfGlyph) failures.push('CJK width/wrap');
if (failures.length > 0) {
  console.error(`FAIL: ${failures.join(', ')}`);
  process.exitCode = 1;
}
