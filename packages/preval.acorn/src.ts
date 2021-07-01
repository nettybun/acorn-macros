import { AsyncFunction } from 'acorn-macros';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { MacroDefinition, LocalMeta } from 'acorn-macros';

async function replaceFn({ importSpecLocal }: LocalMeta, macroExpr: string) {
  const local = importSpecLocal;
  // Prevent naming conflict with this file's imports (fs, path, etc...) and the
  // local identifier (which could be minified) by cutting it out:
  macroExpr = macroExpr.slice(local.length);
  // Process the template string: `A {1 + 1} B` => "A 2 B":
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  macroExpr = (new Function(`return ${macroExpr};`))() as string;
  // That'll handle all the nested ${} blocks? I think?
  const run = new AsyncFunction('fs', 'path', macroExpr);
  const result = (await run(fs, path)) as unknown;
  // I don't want to write a serializer that infinitely expand objects.
  // Dealing with circular objects and huge modules "fs"...no thanks

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
  // Hope your object serializes 🤞. Add serializations as needed Set,Map,etc...
  return String(result);
}

const prevalMacro = (): MacroDefinition => ({
  importName: 'preval.acorn',
  importSpecifiers: {
    preval: {
      rangeFn({ ancestors }) {
        const nodeParent = ancestors[ancestors.length - 2];
        const { type, start, end } = nodeParent; // Worst case this is "Program"
        if (type !== 'TaggedTemplateExpression') {
          throw new Error(`Macro preval must be called a tagged template expression not ${type}`);
        }
        return { start, end };
      },
      replaceFn,
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
