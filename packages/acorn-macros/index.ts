import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import type { Node } from 'acorn';

/** Range from `start` up to but not including `end`. Short form: [start,end) */
type ExprRange = { start: number, end: number };

type Patch = {
  range: ExprRange,
  value: Promise<string>,
};

type ImportPatch = {
  range: ExprRange,
  value: Promise<string>,
  importMeta: ImportMeta,
};

type IdenPatch = {
  range: ExprRange,
  value: Promise<string>,
  valueResolver(value: string): void;
  idenMeta: IdenMeta,
  nestedPatches: IdenPatch[],
};

/** Metadata about a macro's specifiers */
type ImportMeta = {
  source: string,
  specifiers: string[],
};

/** Metadata about a macro's identifier */
type IdenMeta = {
  importSource: string,
  importSpecifier: string,
  importSpecifierIden: string,
  ancestors: Node[],
  /** Data shared between rangeFn and replaceFn (same object reference) */
  state: { [k: string]: unknown },
};

type MacroDefinition = {
  importSource: string,
  importSpecifiers: {
    [name: string]: {
      /**
       * Determines the start/end indices of the macro expression to replace.
       * Nested macros will be replaced before calling `replaceFn` */
      rangeFn: (idenMeta: IdenMeta) => ExprRange,
      /**
       * Determines the replacement for the macro expression. Nested macros have
       * all been replaced, so the expression length may not match the indices
       * from `rangeFn`. Function must return a valid JS expression - note that
       * returning a string would mean using `return '"..."';` */
      replaceFn:
        | ((idenMeta: IdenMeta, macroExpr: string) => Promise<string>)
        | ((idenMeta: IdenMeta, macroExpr: string) => string),
    },
  },
  hookPre?: (originalCode: string) => void,
  hookPost?: (replacedCode: string) => void,
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncFunction
// Isn't a global like Function. Also, Function is "any" type. These are used
// for code generation so I'll define them as returning a string of code.
interface AsyncFunctionConstructor {
  new (...args: [...parameters: string[], expr: string]):
    (...parameters: unknown[]) => Promise<string>
}
const AsyncFunction = (Object.getPrototypeOf(async function() {}) as {
  constructor: AsyncFunctionConstructor }).constructor;

interface FunctionConstructor {
  new (...args: [...parameters: string[], expr: string]):
    (...parameters: unknown[]) => string
}
const Function = (Object.getPrototypeOf(function() {}) as {
  constructor: FunctionConstructor }).constructor;

const importSourceRegex = /\.acorn$|\/acorn-macro$/;

/** Pretty-print interval range */
const p = (x: ExprRange) => `[${x.start},${x.end})`;
// @ts-ignore. Creates a new nested dictionary entry `{}` as needed.
const objGet = <T>(o: Partial<T>, k: string) => (o[k] || (o[k] = {})) as T[keyof T];

async function replaceMacros(code: string, macros: MacroDefinition[], ast?: Node): Promise<string> {
  // Start by parsing the `macros` array into their components
  const mapSourceToIndex: { [source: string]: number } = {};
  const mapSourceToSpecToFns: { [source: string]: MacroDefinition['importSpecifiers'] } = {};
  const hooksPre: ((originalCode: string) => void)[] = [];
  const hooksPost: ((replacedCode: string) => void)[] = [];
  macros.forEach((macro, i) => {
    const source = macro.importSource;
    if (mapSourceToIndex[source]) {
      throw new Error(`Duplicate macro "${source}" at index ${mapSourceToIndex[source]} and ${i}`);
    }
    mapSourceToIndex[source] = i;
    mapSourceToSpecToFns[source] = macro.importSpecifiers;
    if (macro.hookPre) hooksPre.push(macro.hookPre);
    if (macro.hookPost) hooksPost.push(macro.hookPost);
  });

  // Two-way map of minified local identifiers to their import specifier
  // This is a one-to-many relationship

  // "style.acorn": { "injectGlobal": ["xyz", "a1", "a2", ...] }
  const mapSourceSpecToIdens: Partial<{
    [source: string]: Partial<{
      [specifier: string]: string[]
    }>;
  }> = {};

  // "xyz": { source: "style.acorn", specifier: "injectGlobal" }
  const mapIdenToSourceSpec: Partial<{
    [identifier: string]: { source: string, specifier: string };
  }> = {};

  const openStack: IdenPatch[] = [];
  const closedPatches: Patch[] = [];

  // TODO: Maybe remove these? They could be used only once each...
  function pushToOpenStack(patch: IdenPatch) {}
  function pushToClosedList(patch: Patch) {}

  async function applyPatches(codeRange: ExprRange, patches: Patch[]) {
    const patchStrings = await Promise.all(patches.map(p => p.value));
    let expr = (codeRange.start > 0 || codeRange.end < code.length)
      ? code.slice(codeRange.start, codeRange.end)
      : code;
    // Work backwards to not mess up indices
    for (let i = 0; i < patchStrings.length; i++) {
      expr
        = expr.slice(0, patches[i].range.start - codeRange.start)
        + patchStrings[i]
        + expr.slice(patches[i].range.end - codeRange.start);
    }
    return expr;
  }

  async function closePatch(patch: IdenPatch) {
    const { range, nestedPatches, idenMeta } = patch;
    const { importSource, importSpecifier } = idenMeta;
    const { replaceFn } = mapSourceToSpecToFns[importSource][importSpecifier];
    const macroExpr = await applyPatches(range, nestedPatches);
    let macroExprResult;
    try { macroExprResult = await replaceFn({ ...idenMeta }, macroExpr); }
    catch (err) {
      console.error(`Macro eval for:\n${macroExpr}`);
      throw err as Error;
    }
    if (typeof macroExprResult !== 'string') {
      throw new Error(`Macro eval returned ${typeof macroExprResult} instead of a string`);
    }
    patch.valueResolver(macroExprResult);
  }

  // This doesn't have to be a start AST node like node.type === "Program". It
  // can be anything. That's useful to someone somewhere.
  if (!ast) {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  }

  // Call macro.hookPre with original code
  hooksPre.forEach(hook => hook(code));

  // Import statements must come first as per ECMAScript specification but this
  // isn't enforced by Acorn, so throw if an import is after an identifier.
  let seenIndentifier = false;

  type Named = { name: string };
  type IdentifierNode = Node & { name: string };
  type ImportNode = Node & { source: { value: string }, specifiers: SpecifierNode[] };
  type SpecifierNode = Node & { local: Named, imported: Named };
  walk.ancestor(ast, {
    // @ts-ignore
    ImportDeclaration(node: ImportNode) {
      if (seenIndentifier) {
        throw new Error('Import statement found after an identifier');
      }
      const source = node.source.value;
      const specifiers: string[] = [];
      console.log(`Found import statement ${node.start}->${node.end} ${source}`);
      if (!importSourceRegex.exec(source)) return;
      if (!(source in mapSourceToIndex)) {
        console.log(`Skipping unknown macro "${source}"`);
        return;
      }
      node.specifiers.forEach(n => {
        const specifier = n.imported.name;
        const identifier = n.local.name;
        if (!(specifier in mapSourceToSpecToFns[source])) {
          throw new Error(`Import specifier ${specifier} is not part of ${source}`);
        }
        specifiers.push(specifier);
        const specImportMap = objGet(mapSourceSpecToIdens, source);
        const specLocals = objGet(specImportMap, specifier);
        if (specLocals.includes(identifier)) return;
        specLocals.push(identifier);
        mapIdenToSourceSpec[identifier] = { source, specifier };
      });
      // TODO: Hate mixing patches...
      const patch: ImportPatch = {
        value: Promise.resolve(''),
        range: {
          start: node.start,
          end: node.end,
        },
        importMeta: { source, specifiers },
      };
      closedPatches.push(patch);
    },
    // @ts-ignore
    Identifier(node: IdentifierNode, _, ancestors) {
      seenIndentifier = true;
      const identifier = node.name;
      const sourceSpecifier = mapIdenToSourceSpec[identifier];
      if (!sourceSpecifier) return;
      const { source, specifier } = sourceSpecifier;
      console.log('Identifier matches', sourceSpecifier);
      ancestors.forEach((n, i) => {
        console.log(`  - ${'  '.repeat(i)}${n.type} ${p(n)}`);
      });
      // Maintain an object reference so macro authors can pass state around
      const state = {};
      const idenMeta: IdenMeta = {
        importSource: source,
        importSpecifier: specifier,
        importSpecifierIden: identifier,
        ancestors,
        state,
      };
      const { rangeFn } = mapSourceToSpecToFns[source][specifier];
      const range = rangeFn({ ...idenMeta });
      // Task handle which resolves the patch promise when called
      let resolve: (result: string) => void;
      const patch: IdenPatch = {
        range: { start: range.start, end: range.end },
        value: new Promise<string>((res) => { resolve = res; }),
        valueResolver(value) { resolve(value); },
        nestedPatches: [],
        idenMeta,
      };
      // Push to open stack. Follow the O.S -> C.L algorithm for closing patches
      // who end before this patch. Throw as needed for overlapping areas.
      pushToOpenStack(patch);
    },
  });
  // TODO: Clear any remaining open stack items

  // Apply final replacements. Note AST is a Node which fits the ExprRange type
  code = await applyPatches(ast, closedPatches);

  hooksPost.forEach(hook => hook(code));
  return code;
}

export { replaceMacros, Function, AsyncFunction };
export type { MacroDefinition };
