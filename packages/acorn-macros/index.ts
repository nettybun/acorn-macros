import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import type { Node } from 'acorn';

/** Identifies a macro from its unique JS identifier */
type MacroIden = { identifier: string, source: string, specifier: string };
/** Range from [start,end) */
type ExprRange = { start: number, end: number };

type Patch = {
  replacement: Promise<string>,
  task?: PatchTask,
} & ExprRange;

/**
 * Ordered non-overlapping list of patches. The last list item only supports
 * nesting if it references an unstarted task via `patch.task` */
type PatchList = Patch[];

/**
 * Helps resolve a patch. Not all patches need one. Tasks are async functions on
 * the microtask queue and only start once the AST walk is done */
type PatchTask = {
  macroIden: MacroIden,
  patch: Patch;
  patchListNested: PatchList,
  // Called after acorn-walk has read passed `patch.end`. Throws if called after
  // the promise has already resolved.
  run: () => Promise<void>,
};

type MacroDefinition = {
  importSource: string,
  importSpecifiers: {
    [name: string]: {
      /**
       * Determines the start/end indices of the macro expression to replace.
       * Nested macros will be replaced before calling `replaceFn` */
      rangeFn: (macroIden: MacroIden, ASTAncestors: Node[]) => ExprRange,
      /**
       * Determines the replacement for the macro expression. Nested macros have
       * all been replaced, so the expression length may not match the indices
       * from `rangeFn`. Function must return a valid JS expression - note that
       * returning a string would mean using `return '"..."';` */
      replaceFn:
        | ((macroIden: MacroIden, macroExpr: string) => Promise<string>)
        | ((macroIden: MacroIden, macroExpr: string) => string),
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
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const objGet = <T>(o: T, k: string): Exclude<T[keyof T], undefined> => o[k] || (o[k] = {});

async function replaceMacros(code: string, macros: MacroDefinition[], ast?: Node): Promise<string> {
  // Start by parsing the `macros` array into their components
  const macroToIndex: { [importSource: string]: number } = {};
  const macroToSpecifierFns: { [importSource: string]: MacroDefinition['importSpecifiers'] } = {};
  const hooksPre: ((originalCode: string) => void)[] = [];
  const hooksPost: ((replacedCode: string) => void)[] = [];
  macros.forEach((macro, i) => {
    const name = macro.importSource;
    if (macroToIndex[name]) {
      throw new Error(`Duplicate macro "${name}" at indices ${macroToIndex[name]} and ${i}`);
    }
    macroToIndex[name] = i;
    macroToSpecifierFns[name] = macro.importSpecifiers;
    if (macro.hookPre) hooksPre.push(macro.hookPre);
    if (macro.hookPost) hooksPost.push(macro.hookPost);
  });

  // Two-way map of minified local variables to their original import specifier
  const mapSourceSpeciferToLocal: {
    // "style.acorn": { "injectGlobal": ["xyz", "a1", "a2", ...] }
    [macro: string]: { [specifier: string]: string[] | undefined } | undefined;
  } = {};
  const mapLocalToMacroIden: {
    // "xyz": { identifier: "xyz", source: "style.acorn", specifier: "injectGlobal" }
    [identifier: string]: MacroIden | undefined;
  } = {};

  const patchList: PatchList = [];
  const unstartedTasks = new Set<PatchTask>();

  async function applyPatches(codeRange: ExprRange, patches: Patch[]) {
    const patchStrings = await Promise.all(patches.map(p => p.replacement));
    let expr = (codeRange.start > 0 || codeRange.end < code.length)
      ? code.slice(codeRange.start, codeRange.end)
      : code;
    // Work backwards to not mess up indices
    for (let i = 0; i < patchStrings.length; i++) {
      expr
        = expr.slice(0, patches[i].start - codeRange.start)
        + patchStrings[i]
        + expr.slice(patches[i].end - codeRange.start);
    }
    return expr;
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
      console.log(`Found import statement ${node.start}->${node.end} ${source}`);
      if (!importSourceRegex.exec(source)) return;
      if (!(source in macroToIndex)) {
        console.log(`Skipping unknown macro "${source}"`);
        return;
      }
      node.specifiers.forEach(n => {
        const specifier = n.imported.name;
        const identifier = n.local.name;
        if (!(specifier in macroToSpecifierFns[source])) {
          throw new Error(`Import specifier ${specifier} is not part of ${source}`);
        }
        const specImportMap = objGet(mapSourceSpeciferToLocal, source);
        const specLocals = objGet(specImportMap, specifier);
        if (specLocals.includes(identifier)) return;
        specLocals.push(identifier);
        mapLocalToMacroIden[identifier] = { identifier, source, specifier };
      });
      const patch: Patch = {
        replacement: Promise.resolve(''),
        start: node.start,
        end: node.end,
      };
      insertToPatchList(patchList, patch);
    },
    // @ts-ignore
    Identifier(node: IdentifierNode, state, ancestors) {
      seenIndentifier = true;
      const macroIden = mapLocalToMacroIden[node.name];
      if (!macroIden) return;
      console.log('Identifier matches', macroIden);
      ancestors.forEach((n, i) => {
        console.log(`  - ${'  '.repeat(i)}${n.type} ${p(n)}`);
      });
      const {
        rangeFn,
        replaceFn,
      } = macroToSpecifierFns[macroIden.source][macroIden.specifier];
      const range = rangeFn(macroIden, ancestors);
      // Task handle which resolves the patch promise when called
      let taskResolver: (result: string) => void;
      const patch: Patch = {
        replacement: new Promise<string>((req) => { taskResolver = req; }),
        start: range.start,
        end: range.end,
      };
      insertToPatchList(patchList, patch);
      const patchTask: PatchTask = {
        macroIden,
        patch,
        patchListNested: [],
        run,
      };
      let ran = false;
      async function run() {
        if (ran) throw new Error('Task run() already called');
        ran = true;
        unstartedTasks.delete(patchTask);
        // Prevent others from adding to patchListNested by removing the task
        delete patch.task;
        const macroExpr = await applyPatches(range, patchTask.patchListNested);
        let macroExprResult;
        try { macroExprResult = await replaceFn(macroIden!, macroExpr); }
        catch (err) {
          console.error(`Macro eval for:\n${macroExpr}`);
          throw err as Error;
        }
        if (typeof macroExprResult !== 'string') {
          throw new Error(`Macro eval returned ${typeof macroExprResult} instead of a string`);
        }
        taskResolver(macroExprResult);
      }
      unstartedTasks.add(patchTask);
    },
  });
  // Clear any remaining tasks
  // TODO: Shouldn't be a Set()? Just use an array/queue...
  // TODO: How to prevent tasks from running more than once?
  unstartedTasks.forEach(task => { void task.run(); });

  // Apply final replacements. Note AST is a Node which fits the ExprRange type
  code = await applyPatches(ast, patchList);

  hooksPost.forEach(hook => hook(code));
  return code;
}

function insertToPatchList(patchList: PatchList, patch: Patch) {
  // TODO: Call run() on all items before last item
}

export { replaceMacros, Function, AsyncFunction };
export type { MacroDefinition };
