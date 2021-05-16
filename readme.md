# Framework for evaluating and replacing macros in JS

_Work in progress / Not ready. World-building and API design are wrapping up._

Defines a framework for defining macros in JS. These imports are evaluated and
replaced at build-time and have zero runtime overhead. This replaces
babel-plugin-macros and babel.

- It's small: the framework is only 200 lines of code in a single file and only
  depends on acorn and acorn-walk.
- It's fast: Walks the AST once to do special find-and-replace directly on the
  source code; no AST manipulation or serialization at all.

```js
import fs from 'fs';
import { css, colours } from 'style.macro'; // Zero overhead CSS-in-JS
import ms from 'ms.macro'; // Millisecond converter
import preval from 'preval.macro'; // Arbitrary async functions runner

const content = preval`
  const fs = await import('fs');
  return {
    val: fs.readFileSync(__dirname + '/content.md', 'utf8'),
    lineCount() { return content.val.split("\\n").length; }
  };
`;
// Nested macros are run in order - css`` will see ${60000}ms not ${ms('1m')}ms
const classname = css`
  background-color: ${colours.blue._500};
  color: #FFF;
  animation-name: rotate;
  animation-duration: 0.7s, ${ms('1m')}ms;
`;
```

Is turned into:

```js
import fs from 'fs';

const content = {
  val: "# Table of Contents\n- Introduct...",
  lineCount() { return content.val.split("\\n").length; }
};
// Nested macros are run in order - css`` will see ${60000}ms not ${ms('1m')}ms
const classname = "css-YhXC";
```

## How?

This does a single AST parse (optional) and walk to collect start/end indices
for any JS identifiers that are imported by a _"*.macro"_ import. These macros
are given this identifier AST node to determine the code range (start/end)
they'd like to be `eval()`'d on. Later, they're evaluated in the correct order
to handle nested macros. Macros can run arbitrary code to perform their work,
and return a new string of code to replace the macro code range.

## API

TypeScript definitions and example code in _test/_ should explain the API. The
code in _test/_ is copy-pastable as well to get started. The primary export
function is `replaceMacros(code: string, macros: Macro[], ast?: acorn.Node)` and
should be called after your bundler is done; esbuild is used in this repo.

Macro packages such as _style.macro_ provide a function (that may accept
options) which returns a "Macro" object:

```ts
type Macro = {
  importSource: string;
  importSpecifierImpls: { [specifier: string]: any };
  importSpecifierRangeFn: (specifier: string, ancestors: acorn.Node[]) => { start: number, end: number };
  hookPre?: (originalCode: string) => void;
  hookPost?: (replacedCode: string) => void;
}
```

See _test/style.macro/_ for a usage example. For instance, in style.macro, you
initialize the macro and pass it like this:

```ts
import { replaceMacros } from 'acorn-macros';
import { styleMacro } from 'acorn-macros/style.macro/impl';
const codeout = replaceMacros(codein, [
  styleMacro({
    // ...options
  }),
])
```

Here's each part of a Macro object:

- `importSource`: The import name used in source code like "style.macro".
- `importSpecifierImpls`: Object of implementations of each export like "css".
- `importSpecifierRangeFn`: Function that returns a start/end range for its
  macro specifier and ancestor list (directly passed from acorn-walk).
- `hookPre`: Place to do work before any replacements; given `codein`.
- `hookPost`: Place to do work after all replacements; given `codeout`.

Macros basically tell the `replaceMacros` engine that range of code they're
interested in. They'll have a change to evaluate that range once all nested
macros have been replaced first.

Importing a macros doesn't import any real code - they're only TypeScript
definitions - the implementation details are in _xyz.macro/impl_ and are
macro-dependent; you can easily write your own! Read the example macros
provided in _test/_ for inspiration and use `tsconfig.json#paths` to provide
your macro as an importable module - no npm package required!

## Motivation

I wrote this to use my CSS-in-JS macro [styletakeout.macro][1] with esbuild so I
can drop babel and babel-plugin-macros from my toolchain altogether. This work
started as research in another repo called [esbuild-macros][2] which explored
different generic macro-replacement methods such as esbuild plugins, regex
matching, and then finally using acorn-walk.

In a pastlife I would have done a git-filter-branch to pull history to this
repo, but I'm tired; the history is available in the other repo.

## Status

These are the macros I've thought of so far. Contributions welcome! I can help
you wire it up too.

**Legend:**

- ℹ Description/Ideas written
- 🗺 Logic and API design written
- ⚙ Implementation written
- 🆔 TypeScript declaration written
- 🧪 Tests written
- 📝 Docs written
- ⬆ Published
- 📚 Implementations exist elsewhere
- 💁 Help wanted!

**Macros:**

- deindent.macro: ℹ 🗺 📚
- graphql.macro: ℹ 📚 💁
- intl.macro: ℹ 💁
- json.macro: ℹ
- ms.macro: ℹ 🗺 ⚙ 📚
- preval.macro: ℹ 🗺 📚
- sql.macro: ℹ 📚 💁
- style.macro: ℹ 🗺 ⚙ 🆔 🧪 📝 📚
- yaml.macro: ℹ 📚 💁

**Future work:**

- [ ] Performance metrics to see which macros do what amount of work
- [ ] Patch source maps to reflect the macro-replaced code
- [ ] Improve errors by rethrowing macro errors with useful metadata
- [ ] Improve errors using source maps to show original line/column
- [ ] Simplify template strings i.e: `` `a ${50} b` `` to `"a 50 b"`.
- [ ] Simplify normal strings i.e: `"a" + "b"` to `"ab"`.
