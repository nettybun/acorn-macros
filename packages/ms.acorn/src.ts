import { Function } from 'acorn-macros';
import type { MacroDefinition } from 'acorn-macros';

const s = 1000;
const m = s * 60;
const h = m * 60;
const d = h * 24;
const w = d * 7;
const y = d * 365.25;
const conv = { s, m, h, d, w, y };

function ms(time: string) {
  const match = /^(\d+(?:\.\d+)?)\s*(\w+)?$/.exec(time);
  // TODO: Handle hydrating macro errors with location (index) information. This
  // should happen at the replaceMacros() level with sourcemaps, not in
  // individual macros...
  if (!match) {
    throw new Error(`Format "${time}" isn't a valid time for ms.acorn`);
  }
  const [, amount, unit = 's'] = match;
  // eslint-disable-next-line prefer-destructuring
  const letter = unit.toLowerCase()[0] as keyof typeof conv;
  return String(Number(amount) * conv[letter]);
}

const msMacro = (): MacroDefinition => ({
  importSource: 'ms.acorn',
  importSpecifiers: {
    ms: {
      rangeFn(_, ancestors) {
        const nodeParent = ancestors[ancestors.length - 2];
        const { type, start, end } = nodeParent; // Worst case this is "Program"
        if (type !== 'TaggedTemplateExpression' && type !== 'CallExpression') {
          throw new Error(`Macro ms must be called as either a function or a tagged template expression not ${type}`);
        }
        return { start, end };
      },
      replaceFn({ identifier }, macroExpr) {
        return (new Function(identifier, `return ${macroExpr}`))(ms);
      },
    },
  },
});

export { msMacro };
