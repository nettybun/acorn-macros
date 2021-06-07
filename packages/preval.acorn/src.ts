import type { Macro } from 'acorn-macros';
import { createContext, runInContext } from 'vm';

const prevalMacro = (): Macro => {

  return {
    importSource: 'preval.acorn',
    importSpecifierImpls: {
      // XXX: NO BUENO.
      preval(code: string): unknown {
        const context = createContext({ result: '', console });
        const script = `(async () => {${code}})().then(res => { console.log('VM', res); result = res });`;
        runInContext(script, context, {
          microtaskMode: 'afterEvaluate',
          // @ts-ignore Experimental
          importModuleDynamically(specifer, script) {
            console.log('VM IMD', specifer, script);
          },
        });
        return context.result;
      },
    },
    importSpecifierRangeFn: (specifier, ancestors) => {
      if (specifier !== 'preval') {
        throw new Error(`Unknown import "${specifier}" for preval.acorn`);
      }
      const nodeParent = ancestors[ancestors.length - 2];
      const { type, start, end } = nodeParent; // Worst case this is "Program"
      if (type !== 'TaggedTemplateExpression' && type !== 'CallExpression') {
        throw new Error(`Macro preval must be called as either a function or a tagged template expression not ${type}`);
      }
      return { start, end };
    },
  };
};

export { prevalMacro };
