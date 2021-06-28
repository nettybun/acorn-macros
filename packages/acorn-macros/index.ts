import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import type { Node } from 'acorn';

// This library uses the following terms to talk about import statements:
// Given `import { <Spec> as <Local>, <Spec+Local> } from "<Name>";`:
// "Name" is the import source name
// "Spec" is an "imported" import specifier
// "Local" is a "local" import specifier which is the specifier's identifier

// Note that a specifier's local is the same as the specifier unless "as" is
// used. JS minifiers and bundlers will often use "as" to create smaller locals.

/** Range from `start` up to but not including `end`. Short form: [start,end) */
type ExprRange = { start: number, end: number };

/** Describes a macro patch to replace the `range` of code with `value` */
type Patch = {
  localMeta: LocalMeta,
  range: ExprRange,
  value: Promise<string>,
  valueResolver(value: string): void;
  nestedPatches: Patch[],
};

/** Metadata about a macro's local identifier */
type LocalMeta = {
  importName: string,
  importSpec: string,
  importSpecLocal: string,
  ancestors: Node[],
  /** Data shared between rangeFn and replaceFn (same object reference) */
  state: { [k: string]: unknown },
};

type MacroDefinition = {
  importName: string,
  importSpecifiers: {
    [name: string]: {
      /**
       * Determines the start/end indices of the macro expression to replace.
       * Nested macros will be replaced before calling `replaceFn` */
      rangeFn: (localMeta: LocalMeta) => ExprRange,
      /**
       * Determines the replacement for the macro expression. Nested macros have
       * all been replaced, so the expression length may not match the indices
       * from `rangeFn`. Function must return a valid JS expression - note that
       * returning a string would mean using `return '"..."';` */
      replaceFn:
        | ((localMeta: LocalMeta, expr: string) => Promise<string>)
        | ((localMeta: LocalMeta, expr: string) => string),
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

const importNameRegex = /\.acorn$|\/acorn-macro$/;

/** Pretty-print range */
const pR = (x: ExprRange) => `[${x.start},${x.end})`;
/** Pretty-print macro */
const pM = (x: LocalMeta) => `${x.importName}#${x.importSpec}`;
// @ts-ignore. Creates a new nested dictionary entry `{}` as needed.
const objGet = <T>(o: Partial<T>, k: string, or: T[keyof T]) => (o[k] || (o[k] = or)) as T[keyof T];

async function replaceMacros(code: string, macros: MacroDefinition[], ast?: Node): Promise<string> {
  const mapNameToIndex: { [name: string]: number } = {};
  const mapNameToSpecToFn: { [name: string]: MacroDefinition['importSpecifiers'] } = {};
  const hooksPre: ((originalCode: string) => void)[] = [];
  const hooksPost: ((replacedCode: string) => void)[] = [];

  // Start by parsing the `macros` array into their components
  macros.forEach((macro, i) => {
    const name = macro.importName;
    if (mapNameToIndex[name]) {
      throw new Error(`Duplicate macro "${name}" at index ${mapNameToIndex[name]} and ${i}`);
    }
    mapNameToIndex[name] = i;
    mapNameToSpecToFn[name] = macro.importSpecifiers;
    if (macro.hookPre) hooksPre.push(macro.hookPre);
    if (macro.hookPost) hooksPost.push(macro.hookPost);
  });

  // "style.acorn": { "injectGlobal": ["xyz", "a1", "a2", ...] }
  const mapNameToSpecToLocals: Partial<{
    [name: string]: Partial<{
      [spec: string]: string[] // Local identifiers
    }>;
  }> = {};

  // "xyz": { name: "style.acorn", spec: "injectGlobal" }
  const mapLocalToNameAndSpec: Partial<{
    [local: string]: { name: string, spec: string };
  }> = {};

  const importRanges: ExprRange[] = [];
  // Read the design document (in repo) for info about these data structures.
  const openStack: Patch[] = [];
  const closedList: Patch[] = [];

  // This doesn't have to be a start AST node like node.type === "Program". It
  // can be anything. That's useful to someone somewhere.
  if (!ast) {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  }

  // Call macro.hookPre with original code
  hooksPre.forEach(hook => hook(code));

  // Import statements must come first as per ECMAScript specification but this
  // isn't enforced by Acorn, so throw if an import is after an identifier.
  let seenIdentifier = false;

  type HasName = { name: string };
  type IdentifierNode = Node & { name: string };
  type ImportNode = Node & { source: { value: string }, specifiers: SpecifierNode[] };
  type SpecifierNode = Node & { local: HasName, imported: HasName };
  walk.ancestor(ast, {
    // @ts-ignore
    ImportDeclaration(node: ImportNode) {
      if (seenIdentifier) {
        throw new Error('Import statement found after an identifier');
      }
      const { start, end, source: { value: name } } = node;
      console.log(`Found import statement ${start}->${end} ${name}`);
      if (!importNameRegex.exec(name)) return;
      if (!(name in mapNameToIndex)) {
        console.log(`Skipping unknown macro "${name}"`);
        return;
      }
      node.specifiers.forEach(n => {
        const spec = n.imported.name;
        const local = n.local.name;
        if (!(spec in mapNameToSpecToFn[name])) {
          throw new Error(`Import specifier ${spec} is not part of ${name}`);
        }
        const mapSpecToLocals = objGet(mapNameToSpecToLocals, name, {});
        const locals = objGet(mapSpecToLocals, spec, []);
        if (locals.includes(local)) return;
        locals.push(local);
        mapLocalToNameAndSpec[local] = { name, spec };
      });
      importRanges.push({ start, end });
    },
    // @ts-ignore
    Identifier(node: IdentifierNode, _, ancestors) {
      seenIdentifier = true;
      const local = node.name;
      const macroNameAndSpec = mapLocalToNameAndSpec[local];
      if (!macroNameAndSpec) return;
      console.log('Identifier matches', macroNameAndSpec);
      ancestors.forEach((n, i) => {
        console.log(`  - ${'  '.repeat(i)}${n.type} ${pR(n)}`);
      });
      // Maintain an object reference so macro authors can pass state around
      const state = {};
      const localMeta: LocalMeta = {
        importName: macroNameAndSpec.name,
        importSpec: macroNameAndSpec.spec,
        importSpecLocal: local,
        ancestors,
        state,
      };
      // Returns exactly a {start,end} object
      const range = rangeFnTryCall(localMeta);

      // There's at least one
      const lastRangeImport = importRanges[importRanges.length - 1];
      if (range.start < lastRangeImport.end) {
        throw new Error(
          `Macro ${pM(localMeta)} range ${pR(range)} overlaps with an import statement`);
      }
      // Patch to be put onto the open stack (O.S)
      let resolve: (result: string) => void;
      const patch: Patch = {
        range,
        value: new Promise<string>((res) => { resolve = res; }),
        valueResolver(value) { resolve(value); },
        nestedPatches: [],
        localMeta,
      };
      // Push to open stack. Follow the O.S -> C.L algorithm for closing patches
      // who end before this patch. Throw as needed for overlapping areas.
      for (let i = openStack.length - 1; i >= 0; i--) {
        const patch_i = openStack[i];
        const { range: range_i } = patch_i;
        if (range.start > range_i.start && range.end <= range_i.end) {
          break; // Nest it on the stack. We're done.
        }
        if (range.start < range_i.end) {
          throw new Error(`Range overlap trying to stack ${pR(range)} onto ${pR(range_i)}`);
        }
        // TODO: This has to be patch_i. If all tests pass remove this assert
        const popped = openStack.pop() as Patch;
        console.assert(popped === patch_i);

        // Execute the macro asynchronously (floating promise)
        void replaceFnTryCall(patch_i);

        if (openStack.length) {
          // Reparent and loop the for-loop again
          openStack[openStack.length - 1].nestedPatches.push(patch_i);
          continue;
        }
        // Open stack is empty. The stack was converted into a nested tree of
        // running patch promises. Move it to the closed list
        closedListTryPush(patch_i);
      }
      openStack.push(patch);
    },
  });
  // Reached end of AST. Clear remaining open stack layers
  let patch: Patch | undefined;
  while ((patch = openStack.pop())) {
    void replaceFnTryCall(patch);
    if (openStack.length) openStack[openStack.length - 1].nestedPatches.push(patch);
    else closedListTryPush(patch);
  }

  // Apply final replacements. Note AST is a Node which fits the ExprRange type
  code = await applyPatches({ start: ast.start, end: ast.end }, closedList);

  // Remove the import statements. Backwards to maintain indices
  let importRange: ExprRange | undefined;
  while ((importRange = importRanges.pop()))
    code = code.slice(0, importRange.start) + code.slice(importRange.end);

  hooksPost.forEach(hook => hook(code));
  return code;

  // Functions:

  function closedListTryPush(patch: Patch): void {
    if (closedList.length) {
      const lastRangeCL = closedList[closedList.length - 1].range;
      const { range, localMeta } = patch;
      if (range.start < lastRangeCL.end) {
        throw new Error(
          `Macro ${pM(localMeta)} at ${pR(range)} overlaps a closed patch at ${pR(lastRangeCL)}`);
      }
    }
    closedList.push(patch);
  }

  function rangeFnTryCall(localMeta: LocalMeta): ExprRange {
    const { importName, importSpec } = localMeta;
    const { rangeFn } = mapNameToSpecToFn[importName][importSpec];
    const errCommon = `rangeFn() of macro ${importName}#${importSpec}`;
    let result: unknown;
    try {
      // Pass a new object to prevent modifications
      result = rangeFn({ ...localMeta }) as unknown;
    } catch (err) {
      console.error(`Error when calling ${errCommon}:\n`);
      throw err as Error;
    }
    const errPrefix = `Bad return value from ${errCommon}`;
    type R = { start: unknown, end: unknown };
    if (!result || !Number.isInteger((result as R).start) || !Number.isInteger((result as R).end)) {
      throw new Error(`${errPrefix}, must be a { start: int, end: int } object`);
    }
    const range = result as { start: number, end: number };
    if (range.end < range.start) {
      throw new Error(`${errPrefix}, range end came before its start: ${pR(range)}`);
    }
    return { start: range.start, end: range.end };
  }

  // Doesn't return anything since the patch value is written via valueResolver
  async function replaceFnTryCall(patch: Patch): Promise<void> {
    const { range, nestedPatches, localMeta } = patch;
    const { importName, importSpec } = localMeta;
    const { replaceFn } = mapNameToSpecToFn[importName][importSpec];
    // Skipping an "await" here in case that helps the engine avoid microtasks
    const macroExpr = nestedPatches.length
      ? await applyPatches(range, nestedPatches)
      : code.slice(range.start, range.end);
    const errCommon = `replaceFn() of macro ${importName}#${importSpec}`;
    let result: unknown;
    try {
      // Pass a new object to prevent modifications
      result = await replaceFn({ ...localMeta }, macroExpr);
    } catch (err) {
      console.error(`Error when calling ${errCommon}:\n${macroExpr}`);
      throw err as Error;
    }
    if (typeof result !== 'string') {
      throw new Error(`Bad return value from ${errCommon}, must be string not "${typeof result}"`);
    }
    patch.valueResolver(result);
  }

  async function applyPatches(codeRange: ExprRange, patches: Patch[]) {
    const patchStrings = await Promise.all(patches.map(p => p.value));
    let expr = (codeRange.start > 0 || codeRange.end < code.length)
      ? code.slice(codeRange.start, codeRange.end)
      : code;
    // Work backwards to not mess up indices
    for (let i = patchStrings.length - 1; i >= 0; i--) {
      expr
        = expr.slice(0, patches[i].range.start - codeRange.start)
        + patchStrings[i]
        + expr.slice(patches[i].range.end - codeRange.start);
    }
    return expr;
  }
}

export { replaceMacros, Function, AsyncFunction };
export type { MacroDefinition };
