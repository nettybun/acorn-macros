import esbuild from 'esbuild';
import fs from 'fs';
import { replaceMacros } from 'acorn-macros';
import { prevalMacro } from 'preval.acorn/src';

const buildResult = await esbuild.build({
  entryPoints: ['./input.ts'],
  format: 'esm',
  external: ['preval.acorn'],
  write: false,
  bundle: true,
});
const [bundle] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(bundle.contents);
const codeReplaced = await replaceMacros(codeOriginal, [ prevalMacro() ]);
fs.writeFileSync('./out/code-original.js', codeOriginal);
fs.writeFileSync('./out/code-replaced-macros.js', codeReplaced);
console.log('Done ✨');
