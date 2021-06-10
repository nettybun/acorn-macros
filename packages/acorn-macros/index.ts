import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import type { Node } from 'acorn';

type Interval = { start: number, end: number };
// TODO: Not sure the right type yet. Depends on the data structure.
type Task = Interval & { content: Promise<string> }; // ???

type Macro = {
  importSource: string;
  importSpecifierImpls: { [name: string]: unknown };
  importSpecifierRangeFn: (specifier: string, ancestors: Node[]) => Interval;
  hookPre?: (originalCode: string) => void;
  hookPost?: (replacedCode: string) => void;
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncFunction
// Specific to use in this file
interface AsyncFunction extends Function {
  (macroImpl: unknown): Promise<string>;
}
interface AsyncFunctionConstructor {
  new(macroLocal: string, code: string): AsyncFunction;
}
const AsyncFunction = (Object.getPrototypeOf(async function() {}) as {
  constructor: AsyncFunctionConstructor }).constructor;

const importSourceRegex = /\.acorn$|\/acorn-macro$/;

/** Pretty-print interval range */
const p = (x: Interval) => `[${x.start},${x.end})`;

async function replaceMacros(code: string, macros: Macro[], ast?: Node): Promise<string> {
  // Start by parsing the `macros` array into their components
  const macroToIndex: { [importSource: string]: number } = {};
  const macroToSpecifierRangeFns: { [importSource: string]: Macro['importSpecifierRangeFn'] } = {};
  const macroToSpecifierImpls: { [macro: string]: Macro['importSpecifierImpls'] } = {};
  const hooksPre: ((originalCode: string) => void)[] = [];
  const hooksPost: ((replacedCode: string) => void)[] = [];
  macros.forEach((macro, i) => {
    const name = macro.importSource;
    if (macroToIndex[name]) {
      throw new Error(`Duplicate macro "${name}" at indices ${macroToIndex[name]} and ${i}`);
    }
    macroToIndex[name] = i;
    macroToSpecifierRangeFns[name] = macro.importSpecifierRangeFn;
    macroToSpecifierImpls[name] = macro.importSpecifierImpls;
    if (macro.hookPre) hooksPre.push(macro.hookPre);
    if (macro.hookPost) hooksPost.push(macro.hookPost);
  });

  // Two-way map of minified local variables to their original import specifier
  const macroSpecifierToLocals: {
    // "style.acorn": { "injectGlobal": ["xyz", "a1", "a2", ...] }
    [macro: string]: { [specifier: string]: string[] | undefined } | undefined;
  } = {};
  const macroLocalToSpecifiers: {
    // "xyz": { source: "style.acorn", specifier: "injectGlobal" }
    [local: string]: { source: string, specifier: string } | undefined;
  } = {};

  // TODO: Implement the main topo-task-tree data structure
  // Is there only ever one tree root? I think so, since we close/remove a tree
  // when it's done, just before adding the next one. Yeah...
  const intervalTree: Task[] = [];

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
      const sourceName = node.source.value;
      console.log(`Found import statement ${node.start}->${node.end} ${sourceName}`);
      if (!importSourceRegex.exec(sourceName)) return;
      if (!(sourceName in macroToIndex)) {
        console.log(`Skipping unknown macro "${sourceName}"`);
        return;
      }
      node.specifiers.forEach(n => {
        const specImportMap = macroSpecifierToLocals[sourceName] || (macroSpecifierToLocals[sourceName] = {});
        const specLocals = specImportMap[n.imported.name] || (specImportMap[n.imported.name] = []);
        if (specLocals.includes(n.local.name)) return;
        specLocals.push(n.local.name);
        macroLocalToSpecifiers[n.local.name] = {
          source: sourceName,
          specifier: n.imported.name,
        };
      });
      const { start, end } = node;
      intervalTree.push({ start, end, content: Promise.resolve('') });
    },
    // @ts-ignore
    Identifier(node: IdentifierNode, state, ancestors) {
      seenIndentifier = true;
      console.log('Identifier', node.name);
      const meta = macroLocalToSpecifiers[node.name];
      if (!meta) return;
      // Basically "closeRangesUpTo" but instead of evaluating the macro I just
      // resolve the `cursorPromise` for each item up to the current cursor.
      console.log('Identifier matches', meta.source, meta.specifier);
      ancestors.forEach((n, i) => {
        console.log(`  - ${'  '.repeat(i)}${n.type} ${p(n)}`);
      });
      const resolver = macroToSpecifierRangeFns[meta.source];
      const { start, end } = resolver(meta.specifier, ancestors);
      // Macros auto-evaluate when Promise.all([cursorPromise, ...depPromises])
      // resolves. When a macro has evaluated, its fulfillment is part of the
      // lower macro's depPromise. The cursorPromise prevents it from evaluating
      // too early, before other dependent macros are found.
      const content = runMacro({ start, end }, node.name);
      intervalTree.push({ start, end, content });
    },
  });

  // TODO: Pass object reference to the interval tree location? Curious if
  // writing to arr in Promise.all(arr) successfully adds promises or not...
  async function runMacro({ start, end }: Interval, macroLocal: string): Promise<string> {
    const cursorPromise = new Promise((req) => {
      intervalTree.push({ start, end, req });
    });
    // TODO: I need the root to also be some kind of huge promise + eval...so
    // maybe change the "Task" type to be a Promise? Ugh...
    const depPromises: Task[] = [];
    await Promise.all([cursorPromise, ...depPromises.map(x => x.content)]);
    // Separate if object ref? await P.all(depPromises); await cursorPromise;

    // TODO: Wording
    console.log(`Closing open macro range: ${p({ start, end })}`);
    let runSnip = code.slice(start, end);
    // Do eval.
    // Work backwards to not mess up indices
    for (const range of depPromises) {
      runSnip
        = runSnip.slice(0, range.start - start)
        + range.content // TODO: Not await...
        + runSnip.slice(range.end - start);
    }
    const run = new AsyncFunction(macroLocal, `return await ${runSnip}`);
    const { source, specifier } = macroLocalToSpecifiers[macroLocal]!;
    const macroImpl = macroToSpecifierImpls[source][specifier];
    let runResult;
    try {
      runResult = await run(macroImpl);
    }
    catch (err) {
      console.error(`Macro eval for:\n${runSnip}`);
      throw err as Error;
    }
    console.log('Macro eval result:', runResult);
    if (typeof runResult !== 'string') {
      throw new Error(`Macro eval returned ${typeof runResult} instead of a string`);
    }
    return runResult;
  }

  // TODO: Await interval tree? This is the whole root "Task" problem
  await Promise.all(intervalTree);
  code = '...';

  // Call macro.hookPost with macro-replaced code
  hooksPost.forEach(hook => hook(code));
  return code;
}

export { replaceMacros };
export type { Macro };
