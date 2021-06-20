import { AsyncFunction, MacroDefinition } from 'acorn-macros';
import * as fs from 'fs';
import * as path from 'path';
// TODO: Add more?

const prevalMacro = (): MacroDefinition => ({
  importSource: 'preval.acorn',
  importSpecifiers: {
    preval: {
      rangeFn(_, ancestors) {
        const nodeParent = ancestors[ancestors.length - 2];
        const { type, start, end } = nodeParent; // Worst case this is "Program"
        if (type !== 'TaggedTemplateExpression' && type !== 'CallExpression') {
          throw new Error(`Macro preval must be called as either a function or a tagged template expression not ${type}`);
        }
        return { start, end };
      },
      async replaceFn({ identifier }, macroExpr) {
        // There's never a naming conflicts with imports (fs, path, etc...) and
        // the (minified) identifier - I remove it completely
        const char = macroExpr[identifier.length];
        if (char === '(') {
          // Extract slice between >identifier("< and >")<
          macroExpr = macroExpr.slice(identifier.length + 1, macroExpr.length - 2);
        } else if (char === '`') {
          // Extract slice between >identifier`< and >`<
          macroExpr = macroExpr.slice(identifier.length, macroExpr.length - 1);
        } else {
          throw new Error(`Unexpected use of preval function:\n${macroExpr}`);
        }
        // TODO: Even provide globals at all? Let them import it?
        const run = new AsyncFunction('fs', 'path', macroExpr);
        return run(fs, path);
      },
    },
  },
});

export { prevalMacro };
