import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import type { Node } from 'acorn';

type Interval = { start: number, end: number };

type Zippable = Promise<string> & {
  indexStart: number,
  indexEnd: number,
}

// Has it's own private runner function to resolve the zippable value.
type Task = Zippable & {
  macro: { source: string, identifier: string, specifier: string },
  innerTasks: Array<Task>,
  flagAsParsed(): void,
};

// A plugin
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
  const macroSpecifierToIdendifiers: {
    // "style.acorn": { "injectGlobal": ["xyz", "a1", "a2", ...] }
    [macro: string]: { [specifier: string]: string[] | undefined } | undefined;
  } = {};
  const macroIdentifierToSpecifiers: {
    // "xyz": { source: "style.acorn", specifier: "injectGlobal" }
    [identifier: string]: { source: string, specifier: string } | undefined;
  } = {};

  // XXX: Each item is a non-overlappting root from [start,end). Not all zips
  // support nesting, so this is considered "flat" even though tasks will have
  // dependencies as `task.innerTasks`.
  const zipList: Zippable[] = [];

  // TODO: Unused?
  /** Pretty-print interval range */
  const p = (x: Interval) => `[${x.start},${x.end})`;

  /** Create and start a task. It'll resolve to the macro replacement */
  function spawnTask(
    meta: { source: string, identifier: string, specifier: string },
    interval: { start: number, end: number }
  ): Task {
    let taskResolve: (result: string) => void;
    let parsedResolve: () => void;
    // @ts-ignore
    const task: Task = new Promise<string>((req) => { taskResolve = req; });
    task.macro = meta;
    task.innerTasks = [];
    task.indexStart = interval.start;
    task.indexEnd = interval.end;
    const isParsed = new Promise<void>((req) => { parsedResolve = req; });
    task.flagAsParsed = () => parsedResolve();

    const taskRunner = async () => {
      await isParsed;
      const runnerCode = await zipString(code, interval, task.innerTasks);
      const runner = new AsyncFunction(meta.identifier, `return await ${runnerCode}`);
      const macroImpl = macroToSpecifierImpls[meta.source][meta.specifier];
      let runnerResult;
      try { runnerResult = await runner(macroImpl); }
      catch (err) {
        console.error(`Macro eval for:\n${runnerCode}`);
        throw err as Error;
      }
      console.log('Macro eval result:', runnerResult);
      if (typeof runnerResult !== 'string') {
        throw new Error(`Macro eval returned ${typeof runnerResult} instead of a string`);
      }
      taskResolve(runnerResult);
    };
    // Floating promise. Keep parsing other identifiers and handle it later.
    void taskRunner();
    return task;
  }

  async function zipString(code: string, interval: Interval, zips: Zippable[]) {
    const zipResults = await Promise.all(zips);
    const { start, end } = interval;
    let runnerCode = end - start < code.length
      ? code.slice(start, end)
      : code;
    // Work backwards to not mess up indices
    for (let i = 0; i < zipResults.length; i++) {
      const str = zipResults[i];
      const { indexStart, indexEnd } = zips[i];
      runnerCode
          = runnerCode.slice(0, indexStart - start)
          + str
          + runnerCode.slice(indexEnd - start);
    }
    return runnerCode;
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
      const sourceName = node.source.value;
      console.log(`Found import statement ${node.start}->${node.end} ${sourceName}`);
      if (!importSourceRegex.exec(sourceName)) return;
      if (!(sourceName in macroToIndex)) {
        console.log(`Skipping unknown macro "${sourceName}"`);
        return;
      }
      node.specifiers.forEach(n => {
        const specImportMap = macroSpecifierToIdendifiers[sourceName] || (macroSpecifierToIdendifiers[sourceName] = {});
        const specLocals = specImportMap[n.imported.name] || (specImportMap[n.imported.name] = []);
        if (specLocals.includes(n.local.name)) return;
        specLocals.push(n.local.name);
        macroIdentifierToSpecifiers[n.local.name] = {
          source: sourceName,
          specifier: n.imported.name,
        };
      });
      // @ts-ignore
      const importTask: Zippable = Promise.resolve('');
      importTask.indexStart = node.start;
      importTask.indexEnd = node.end;
      insertToZipList(importTask);
    },
    // @ts-ignore
    Identifier(node: IdentifierNode, state, ancestors) {
      seenIndentifier = true;
      console.log('Identifier', node.name);
      const meta = macroIdentifierToSpecifiers[node.name];
      if (!meta) return;
      // TODO: flagAsParsed() up to node.loc
      console.log('Identifier matches', meta.source, meta.specifier);
      ancestors.forEach((n, i) => {
        console.log(`  - ${'  '.repeat(i)}${n.type} ${p(n)}`);
      });
      const resolver = macroToSpecifierRangeFns[meta.source];
      const interval = resolver(meta.specifier, ancestors);
      const macroTask = spawnTask({ ...meta, identifier: node.name }, interval);
      insertToZipList(macroTask);
    },
  });
  // TODO: flagAsParsed() up to ast.end

  // Final zip
  code = await zipString(code, { start: 0, end: code.length }, zipList);

  // Call macro.hookPost with macro-replaced code
  hooksPost.forEach(hook => hook(code));
  return code;
}

// TODO: Port the IntervalList from acorn-macros-sync
function insertToZipList(zip: Zippable) {}

export { replaceMacros };
export type { Macro };
