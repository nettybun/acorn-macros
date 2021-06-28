import esbuild from 'esbuild';
import fs from 'fs';
import { replaceMacros } from 'acorn-macros';
import {
  styleMacro,
  // Import aliases turn on syntax highlighting
  cssImpl as css,
  injectGlobalImpl as injectGlobal
} from 'style.acorn/src';

// Toss some global styles in immediately before the JS is even bundled/read.
injectGlobal`
  body {
    background-color: fuchsia;
  }
`;

const buildResult = await esbuild.build({
  entryPoints: ['./input.ts'],
  format: 'esm',
  external: ['style.acorn'],
  write: false,
  bundle: true,
});
const [bundle] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(bundle.contents);

const importObjects = {
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
};

declare module 'style.acorn' {
  const decl:    typeof importObjects.decl;
  const colours: typeof importObjects.colours;
  const classes: typeof importObjects.classes;
  const sizes:   typeof importObjects.sizes;
}

const codeReplaced = await replaceMacros(codeOriginal, [
  styleMacro({
    // Here '...' is for returning JS code and '"..."' is for returning strings
    importObjects,
    outFile: './out/styles.css',
  }),
]);
// Consider using cssbeautify (npm package) to prettify the CSS?
fs.writeFileSync('./out/code-original.js', codeOriginal);
fs.writeFileSync('./out/code-replaced-macros.js', codeReplaced);
console.log('Done ✨');
