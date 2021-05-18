// This is the AST processing code used in replaceMacro(). It's looking for tag
// template expressions and objects member expressions. If you're a macro author
// you might want to support other types too, such as unary expressions,
// function calls, etc.

// TODO: Implement everything styletakeout.macro does. Including caching via
// hashing and naming with location information, etc.

import * as fs from 'fs';
import * as path from 'path';
import { evalMeta } from 'acorn-macros';

// @ts-ignore TS can't resolve Macro#importSpecifierRangeFn#ancestors...
import type { Node } from 'acorn';
import type { Macro } from 'acorn-macros';

// Side effect: Start a stylesheet immediately
let sheet = '';

function interpolateTemplateString(quasis: TemplateStringsArray, expressions: unknown[]) {
  let string = '';
  for (let i = 0; i < expressions.length; i++) {
    string += quasis[i] + String(expressions[i]);
  }
  string += quasis[quasis.length - 1];
  return string.replace(/\n?\s*/g, '');
}

function cssImpl(statics: TemplateStringsArray, ...templateVariables: unknown[]) {
  const string = interpolateTemplateString(statics, templateVariables);
  sheet += `css: ${string}\n`;
  console.log('cssImpl', string);
  // TODO: Location might not be provided if called outside of replaceMacros()
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const location = `[${evalMeta.snipRawStart ?? '?'},${evalMeta.snipRawEnd ?? '?'})`;
  // Put back a string. Also! Consider str.replaceAll('"', '\\"') as needed
  return `"css-${location}"`;
}

function injectGlobalImpl(statics: TemplateStringsArray, ...templateVariables: unknown[]) {
  const string = interpolateTemplateString(statics, templateVariables);
  sheet += `injectGlobal: ${string}\n`;
  console.log('injectGlobalImpl', string);
  // Put literally nothing back
  return '';
}

type ImportObject = { [importSpecfier: string]: string | ImportObject };
type Options = {
  importObjects?: ImportObject,
  outFile?: string,
  verbose?: boolean,
  beautify?: boolean,
};

const styleMacro = (options: Options = {}): Macro => {
  const importObjects = options.importObjects ?? {};
  return {
    importSource: 'style.acorn',
    importSpecifierImpls: {
      css: cssImpl,
      injectGlobal: injectGlobalImpl,
      ...importObjects,
    },
    importSpecifierRangeFn: (importSpecifier, identifierAncestors) => {
      const [node, nodeParent, ...nodeRest] = [...identifierAncestors].reverse();
      if ('css' === importSpecifier || 'injectGlobal' === importSpecifier) {
        if (nodeParent.type !== 'TaggedTemplateExpression') {
          throw new Error('Macros css and injectGlobal must be called as tag template functions');
        }
        return { start: nodeParent.start, end: nodeParent.end };
      }
      if (importSpecifier in importObjects) {
        if (nodeParent.type !== 'MemberExpression') {
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          throw new Error(`Import object ${importSpecifier} must be accessed as an object: ${node.name}.x.y.z`);
        }
        let top = nodeParent;
        for (const node of nodeRest) if (node.type === 'MemberExpression') top = node;
        return { start: top.start, end: top.end };
      }
      throw new Error(`Unknown import "${importSpecifier}" for style.acorn`);
    },
    hookPost() {
      const outFile = options.outFile ?? './out.css';
      const outPath = path.resolve(outFile);
      console.log(`CSS written to ${outPath}`);
      fs.writeFileSync(outPath, sheet);
    },
  };
};

// Implementations are exported in case you want to use them directly in the
// options object outside of the source code
export { styleMacro, cssImpl, injectGlobalImpl };
