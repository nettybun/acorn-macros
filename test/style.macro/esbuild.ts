import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { replaceMacros } from 'acorn-macros';
import {
  styleMacro,
  // Import aliases turn on syntax highlighting
  cssImpl as css,
  injectGlobalImpl as injectGlobal
} from 'style.macro/impl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rel = (...paths: string[]) => path.resolve(__dirname, ...paths);

// Toss some global styles in immediately before the JS is even bundled/read.
injectGlobal`
  body {
    background-color: fuchsia;
  }
`;

const buildResult = await esbuild.build({
  entryPoints: [rel('input.ts')],
  format: 'esm',
  plugins: [{
    name: 'externalize-macros',
    setup(build) {
      build.onResolve({ filter: /.+\.macro$/ }, ({ path }) =>
        ({ path, external: true }));
    },
  }],
  // Pass to buildResult instead as buildResult.outputFiles
  write: false,
  bundle: true,
  minify: true,
});

const [bundle] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(bundle.contents);

const codeReplaced = replaceMacros(codeOriginal, [
  styleMacro({
    // Here '...' is for returning JS code and '"..."' is for returning strings
    // TODO: Explore ways to dedupe this with input.ts
    importObjects: {
      value: '2021',
      decl: {
        pageBackground: '"pageBackground"',
        textBackground: '"textBackground"',
        textColour: '"textColour"',
      },
      colours: {
        black: '"#000"',
      },
      classes: {
        center: css`text-align: center;`,
        text: {
          _0_xs: css`font-size: 0.75rem;`,
          _1_sm: css`font-size: 0.875rem;`,
        },
      },
      sizes: {
        _03: '"30px"',
        _04: '"40px"',
        _05: '"50px"',
      },
    },
    outFile: rel('out/styles.css'),
    verbose: true,
    beautify: true,
  }),
]);
fs.writeFileSync(rel('out/code-original.js'), codeOriginal);
fs.writeFileSync(rel('out/code-replaced-macros.js'), codeReplaced);
console.log('Done ✨');
