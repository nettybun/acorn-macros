import type { Macro } from 'acorn-macros';

const prevalMacro = (): Macro => {
  return {
    importSource: 'preval.acorn',
    importSpecifierImpls: {
      // XXX: NO BUENO.
      async preval(code: string): Promise<unknown> {
        const asyncFn = eval(`async () => {${code}}`) as () => Promise<unknown>;
        const result = await asyncFn();
        return JSON.stringify(result);
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
