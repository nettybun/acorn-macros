// The "declare module" block tells TS the values of the imports so autocomplete
// works as expected.

// TODO: Is there a way to dedup this in esbuild.ts and input.ts?
declare module 'style.macro' {
  const value: 2021;
  const decl: {
    pageBackground: 'pageBackground',
    textBackground: 'textBackground',
    textColour: 'textColour',
  };
  const colours: {
    black: '#000',
  };
  const classes: {
    center: 'text-align: center;',
    text: {
      _0_xs: 'font-size: 0.75rem;',
      _1_sm: 'font-size: 0.875rem;',
    },
  };
  const sizes: {
    _03: '30px',
    _04: '40px',
    _05: '50px',
  };
}

import { css, decl, sizes, colours, classes, value } from 'style.macro';

const exportedVariable = colours.black;
const styles = css`
  padding: 15px;
  background-color: ${colours.black};
  margin-top: ${sizes._05};
  margin-left: ${sizes._04};
  margin-right: ${sizes._03};
`;

// TODO: Ask Evan if this is safe for their upcoming lexer rewrite
function shadow(css: number) {
  return css + 10;
}

console.log(shadow(10));
console.log(styles);
console.log(value);
console.log(decl.pageBackground);

// These need to be assigned to a variable else --minify-sytax literally removes
// the string contents (!) since they're unused.
const v1 = `m5 p5 ${css`vertical-align: middle`} align-center ${styles} ${classes.text._0_xs}`;
const v2 = `m5 p5 ${css`vertical-align: middle`} align-center`;
const v3 = `m5 p5 ${styles} ${css`vertical-align: middle`} align-center ${styles}`;
const v4 = `${styles} ${css`vertical-align: middle`}`;
const v5 = `${css`vertical-align: middle`}`;
const v6 = `${css`vertical-align: middle`} hello`;
