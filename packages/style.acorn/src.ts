import fs from 'fs';
import { compile, serialize, stringify } from 'stylis';
import { Function } from 'acorn-macros';

import type { MacroDefinition } from 'acorn-macros';

type MacroImportSpecifer = MacroDefinition['importSpecifiers'][''];
type RangeFn = MacroImportSpecifer['rangeFn'];

// These are two separate maps so global styles are written before classes. They
// map the CSS string to a "hash" of "N<counter>L<length>". They're also used to
// resolve duplicates "naturally" without hashing: I'm hoping the JS engine's
// hash function for Map/Set is faster than @emotion/hash's murmurhash2
const cssGlobals = new Map<string, string>();
const cssClasses = new Map<string, string>();

// Perf boost if I "hash" before running Stylis? Can this be sure to remove
// duplicates? Even Stylis may not fully dedupe the CSS - rule order could
// change the hash... Might not be worth the complexity.

type ImportObject = { [importSpecfier: string]: string | ImportObject };
type Options = {
  importObjects?: ImportObject,
  outFile?: string,
  classPrefix?: string,
};

// Default config and then becomes resolved config at runtime
const opts: Required<Options> = {
  importObjects: {},
  outFile: './styles.css',
  classPrefix: '',
};

function interpolateTemplateString(quasis: TemplateStringsArray, expressions: unknown[]) {
  let string = '';
  for (let i = 0; i < expressions.length; i++) {
    string += quasis[i] + String(expressions[i]);
  }
  string += quasis[quasis.length - 1];
  return string.replace(/\n?\s*/g, '');
}

function cssImpl(statics: TemplateStringsArray, ...templateVariables: unknown[]) {
  const str = interpolateTemplateString(statics, templateVariables);
  const strStylis = serialize(compile(`X{${str}}`), stringify);
  console.log(strStylis);
  let id = cssClasses.get(strStylis);
  if (!id) {
    id = `N${cssClasses.size}L${strStylis.length - 3}`; // Drop `X{` and `}`
    cssClasses.set(strStylis, id);
  }
  // Put back a string. Hope they didn't use `"` in their classPrefix...
  return `"${opts.classPrefix}${id}"`;
}

function injectGlobalImpl(statics: TemplateStringsArray, ...templateVariables: unknown[]) {
  const str = interpolateTemplateString(statics, templateVariables);
  const strStylis = serialize(compile(str), stringify);
  console.log(strStylis);
  let id = cssGlobals.get(strStylis);
  if (!id) {
    id = `N${cssGlobals.size}L${strStylis.length}`;
    cssGlobals.set(strStylis, id);
  }
  // Put literally nothing back
  return '';
}

const rangeFnForTagTemplates: RangeFn = ({ specifier }, ancestors) => {
  const nodeParent = ancestors[ancestors.length - 2]; // Identifier is - 1
  const { type, start, end } = nodeParent;
  if (type !== 'TaggedTemplateExpression') {
    throw new Error(`Macro ${specifier} must be called as a tagged template expression not ${type}`);
  }
  return { start, end };
};

const styleMacro = (options: Options = {}): MacroDefinition => {
  // Overlay given options onto the default options
  Object.assign(opts, options);
  const { importObjects } = opts;
  let timeStart = 0;
  let timeEnd = 0;
  const macroDef: MacroDefinition = {
    importSource: 'style.acorn',
    importSpecifiers: {
      css: {
        rangeFn: rangeFnForTagTemplates,
        replaceFn(macroIden, macroExpr) {
          const run = new Function(macroIden.identifier, `return ${macroExpr}`);
          return run(cssImpl);
        },
      },
      injectGlobal: {
        rangeFn: rangeFnForTagTemplates,
        replaceFn(macroIden, macroExpr) {
          const run = new Function(macroIden.identifier, `return ${macroExpr}`);
          return run(injectGlobalImpl);
        },
      },
    },
    hookPre() {
      timeStart = performance.now();
    },
    hookPost() {
      timeEnd = performance.now();

      let styles = '';
      for (const [style, tag] of cssGlobals.entries()) {
        styles += '/* ' + tag + ' */\n' + style + '\n';
      }
      for (const [style, tag] of cssClasses.entries()) {
        styles += '.' + opts.classPrefix + tag + style.slice(1) + '\n';
      }
      const total = cssGlobals.size + cssClasses.size;
      const ms = Math.round(timeEnd - timeStart);
      // Lowkey pluralize by adding "s"
      const s = (n: number) => n === 1 ? '' : 's';
      console.log(`Moved ${total} CSS snippet${s(total)} to '${opts.outFile}' with style.acorn in ${ms}ms`);
      fs.writeFileSync(opts.outFile, styles);
    },
  };
  for (const name of Object.keys(importObjects)) {
    macroDef.importSpecifiers[name] = {
      rangeFn({ specifier }, ASTAncestors) {
        const [node, nodeParent, ...nodeRest] = [...ASTAncestors].reverse();
        if (nodeParent.type !== 'MemberExpression') {
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          throw new Error(`Import ${specifier} must be accessed as an object: ${node.name}.x.y.z`);
        }
        let top = nodeParent;
        for (const node of nodeRest) if (node.type === 'MemberExpression') top = node;
        return { start: top.start, end: top.end };
      },
      replaceFn({ identifier }, macroExpr) {
        // If importObjects supported only one level deep (aka no objects) I
        // could get away with `return importObjects[macroExpr]`...
        const run = new Function(identifier, `return ${macroExpr}`);
        return run(importObjects[name]);
      },
    };
  }
  return macroDef;
};

// Implementations are exported in case you want to use them directly in the
// options object outside of the source code
export { styleMacro, cssImpl, injectGlobalImpl };
