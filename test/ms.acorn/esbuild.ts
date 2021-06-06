import esbuild from 'esbuild';
import fs from 'fs';
import { replaceMacros } from 'acorn-macros';
import { msMacro } from 'ms.acorn/src';

const buildResult = await esbuild.build({
  entryPoints: ['./input.ts'],
  format: 'esm',
  external: ['ms.acorn'],
  write: false,
  bundle: true,
});
const [bundle] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(bundle.contents);
const codeReplaced = replaceMacros(codeOriginal, [ msMacro() ]);
fs.writeFileSync('./out/code-original.js', codeOriginal);
fs.writeFileSync('./out/code-replaced-macros.js', codeReplaced);
console.log('Done ✨');
