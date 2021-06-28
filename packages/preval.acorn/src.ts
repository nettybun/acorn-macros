import { AsyncFunction } from 'acorn-macros';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { MacroDefinition } from 'acorn-macros';

const prevalMacro = (): MacroDefinition => ({
  importName: 'preval.acorn',
  importSpecifiers: {
    preval: {
      rangeFn({ ancestors }) {
        const nodeParent = ancestors[ancestors.length - 2];
        const { type, start, end } = nodeParent; // Worst case this is "Program"
        if (type !== 'TaggedTemplateExpression' && type !== 'CallExpression') {
          throw new Error(`Macro preval must be called as either a function or a tagged template expression not ${type}`);
        }
        return { start, end };
      },
      async replaceFn({ importSpecLocal: local }, macroExpr) {
        // There's never a naming conflict with imports (fs, path, etc...) and
        // the (minified) identifier - I remove it completely
        const char = macroExpr[local.length];
        if (char === '(') {
          // Extract slice between >identifier("< and >")<
          macroExpr = macroExpr.slice(local.length + 2, macroExpr.length - 2);
        } else if (char === '`') {
          // Extract slice between >identifier`< and >`<
          macroExpr = macroExpr.slice(local.length + 1, macroExpr.length - 1);
        } else {
          throw new Error(`Unexpected use of preval function:\n${macroExpr}`);
        }
        const run = new AsyncFunction('fs', 'path', macroExpr);
        const result = (await run(fs, path)) as unknown;
        // I don't want to write a serializer that infinitely expand objects.
        // That's hard. There's circulary things and imagine trying to serialize
        // something huge like "fs" as a module. No thanks.

        if (result && typeof result === 'object') {
          // Can't JSON.stringify because that silently drops things including
          // functions. Also it returns strings, not code...
          const pairs = Object.entries(result).map(([key, value]) => {
            if (typeof value === 'function' && (value as {name: string}).name === key)
              return String(value);
            else
              return `"${key}":${tryString(value)}`;
          });
          return `{${pairs.join(',')}}`;
        }
        // TODO: Add more serializations here like Set,Map,etc...

        return String(result); // Hope your object serializes :^)
      },
    },
  },
});

function tryString(x: unknown) {
  if (typeof x === 'string') return '"' + x.replaceAll('\n', '\\n') + '"';
  const xString = String(x);
  if (xString.startsWith('[object ')) {
    console.error(x, `\nSerializes to "${xString}" which is probably wrong`);
    throw new Error('Can\'t serialize the above preval result into JS code');
  }
  return xString;
}

export { prevalMacro };
