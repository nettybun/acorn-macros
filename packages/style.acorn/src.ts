import fs from 'fs';
import { evalMeta } from 'acorn-macros';
import { compile, serialize, stringify } from 'stylis';
// TODO: Consider using @emotion/hash to hash the CSS snippets

import type { Macro } from 'acorn-macros';

// Side effect of importing is to start a stylesheet immediately
let sheet = '';
let snippetCount = 0;
let timeStart = 0;
let timeEnd = 0;

type ImportObject = { [importSpecfier: string]: string | ImportObject };
type Options = {
  importObjects?: ImportObject,
  outFile?: string,
  classPrefix?: string,
};

// Default config and then becomes resolved config at runtime
const opts: Required<Options> = {
  importObjects: {},
  outFile: './style.css',
  classPrefix: 'css-',
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
  // TODO: Hash?
  const tag = `${opts.classPrefix}${evalMeta.snipRawStart}`;
  const style = interpolateTemplateString(statics, templateVariables);
  const styleCompiled = serialize(compile(`.${tag}{${style}}`), stringify);
  sheet += styleCompiled + '\n';
  snippetCount++;
  // Put back a string. Also! Consider str.replaceAll('"', '\\"') as needed
  return `"${tag}"`;
}

function injectGlobalImpl(statics: TemplateStringsArray, ...templateVariables: unknown[]) {
  const style = interpolateTemplateString(statics, templateVariables);
  const styleCompiled = serialize(compile(style), stringify);
  sheet += `/* ${evalMeta.snipRawStart} */\n` + styleCompiled + '\n';
  snippetCount++;
  // Put literally nothing back
  return '';
}

const styleMacro = (options: Options = {}): Macro => {
  // Overlay given options onto the default options
  Object.assign(opts, options);
  const { importObjects } = opts;
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
    hookPre() {
      timeStart = performance.now();
    },
    hookPost() {
      timeEnd = performance.now();
      const ms = Math.round(timeEnd - timeStart);
      const outFile = options.outFile ?? './styles.css';
      // Lowkey pluralize by adding "s"
      const s = (n: number) => n === 1 ? '' : 's';
      console.log(`Moved ${snippetCount} CSS snippet${s(snippetCount)} to '${
        outFile}' with style.acorn in ${ms}ms`);
      fs.writeFileSync(outFile, sheet);
    },
  };
};

// Implementations are exported in case you want to use them directly in the
// options object outside of the source code
export { styleMacro, cssImpl, injectGlobalImpl };
