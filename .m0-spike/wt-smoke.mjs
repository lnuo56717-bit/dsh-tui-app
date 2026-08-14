import {writeFileSync} from 'node:fs';
import React from 'react';
import {Box, Text, render} from 'ink';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('report path is required');

const whale = [
  '                   .',
  '              .   /',
  '         ____/|__/',
  '    ____/        `---.',
  ' __/        _        o\\',
  '<__        (_)      __/',
  '   `---._________.--\'',
  '        \\__/',
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  node: process.version,
  wtSession: process.env.WT_SESSION ?? null,
  termProgram: process.env.TERM_PROGRAM ?? null,
  isTTY: Boolean(process.stdout.isTTY),
  columns: process.stdout.columns ?? null,
  rows: process.stdout.rows ?? null,
  colorDepth: typeof process.stdout.getColorDepth === 'function' ? process.stdout.getColorDepth() : null,
  enterWritten: false,
  leaveWritten: false,
  inkMounted: false,
  restoredAfterError: false,
};

process.stdout.write('\u001B[?1049h\u001B[?25l');
report.enterWritten = true;
let instance;
try {
  const App = () => React.createElement(
    Box,
    {flexDirection: 'column', paddingLeft: 2},
    React.createElement(Text, {color: '#178BFF'}, whale.join('\n')),
    React.createElement(Text, {color: '#FF7A6E'}, 'DeepSeek TUI  中文，ＡＢ  Windows Terminal smoke'),
  );
  instance = render(React.createElement(App), {exitOnCtrlC: false, patchConsole: false});
  report.inkMounted = true;
  await sleep(250);
} finally {
  instance?.unmount();
  process.stdout.write('\u001B[?25h\u001B[?1049l');
  report.leaveWritten = true;
  report.restoredAfterError = true;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}
