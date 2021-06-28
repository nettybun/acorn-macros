import esbuild from 'esbuild';
import fs from 'fs';
import { replaceMacros } from 'acorn-macros';
import { msMacro } from 'ms.acorn/src';
import { styleMacro } from 'style.acorn/src';

const buildResult = await esbuild.build({
  entryPoints: ['./input.ts'],
  format: 'esm',
  plugins: [{
    name: 'skip-acorn-macros',
    setup(build) {
      build.onResolve({ filter: /.+\.acorn$/ }, ({ path }) =>
        ({ path, external: true }));
    },
  }],
  // Pass to buildResult instead as buildResult.outputFiles
  write: false,
  bundle: true,
  // minify: true,
});
const [bundle] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(bundle.contents);
const codeReplaced = await replaceMacros(codeOriginal, [
  msMacro(),
  styleMacro(),
]);
fs.writeFileSync('./out/code-original.js', codeOriginal);
fs.writeFileSync('./out/code-replaced-macros.js', codeReplaced);
console.log('Done ✨');
