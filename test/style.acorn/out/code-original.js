// input.ts
import {css, decl, sizes, colours, classes} from "style.acorn";
var exportedVariable = colours.black;
var styles = css`
  padding: 15px;
  background-color: ${colours.black};
  margin-top: ${sizes._05};
  margin-left: ${sizes._04};
  margin-right: ${sizes._03};
`;
function shadow(css2) {
  return css2 + 10;
}
console.log(shadow(10));
console.log(styles);
console.log(decl.pageBackground);
var v1 = `m5 p5 ${css`vertical-align: middle`} align-center ${styles} ${classes.text._0_xs}`;
var v2 = `m5 p5 ${css`vertical-align: middle`} align-center`;
var v3 = `m5 p5 ${styles} ${css`vertical-align: middle`} align-center ${styles}`;
var v4 = `${styles} ${css`vertical-align: middle`}`;
var v5 = `${css`vertical-align: middle`}`;
var v6 = `${css`vertical-align: middle`} hello`;
