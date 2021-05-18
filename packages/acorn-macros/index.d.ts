type Macro = {
  importSource: string;
  importSpecifierImpls: { [name: string]: unknown };
  importSpecifierRangeFn: (specifier: string, ancestors: acorn.Node[]) => IntervalRange;
  hookPre?: (originalCode: string) => void;
  hookPost?: (replacedCode: string) => void;
};
type IntervalRange = { start: number, end: number };
type OpenMacroRange = IntervalRange & { macroLocal: string };
type ClosedMacroRange = IntervalRange & { replacement: string };

const evalMeta: {
  snipRaw: string;
  snipRawStart: number;
  snipRawEnd: number;
  snipEval: string;
  macroSource: string;
  macroSpecifier: string;
};

const replaceMacros: (code: string, macros: Macro[], ast?: acorn.Node) => string;

export { replaceMacros, evalMeta };
export type { Macro };
