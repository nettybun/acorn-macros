# Framework for evaluating and replacing macros in JS

_Work in progress ⚠_

_**These docs are out of date. The API has changed. Sorry!**_

Defines a framework for defining macros in JS. These imports are evaluated and
replaced at build-time and have zero runtime overhead. This replaces
babel-plugin-macros and babel.

- It's small: the framework is only 200 lines of code in a single file and only
  depends on acorn and acorn-walk.
- It's fast: Walks the AST once to do special find-and-replace directly on the
  source code; no AST manipulation or serialization at all.

```js
import fs from 'fs';
import { css, colours } from 'style.acorn'; // Zero overhead CSS-in-JS
import ms from 'ms.acorn'; // Millisecond converter
import preval from 'preval.acorn'; // Runs an async function at compile-time

const content = preval`
  const fs = await import('fs');
  const content = fs.readFileSync('../content.md', 'utf8');
  return {
    val: content,
    lineCount() { return content.split("\\n").length; }
  };
`;
// Nested macros are run in order. First ms.acorn replaces `ms(...)` with a
// number. Next, style.macro reads the CSS and replaces it with a classname.
const classname = css`
  background-color: ${colours.blue._500};
  color: #FFF;
  animation-name: rotate;
  animation-duration: 0.7s, ${ms('1 min')}ms;
`;
```

Turns into:

```js
import fs from 'fs';

const content = {
  val: "# Table of Contents\n- Introduct...",
  lineCount() { return content.val.split("\\n").length; }
};

// Hash of the CSS and source location of the css`` macro.
const classname = "css-YhXC-584";
```

## Install

Search npm for `*.acorn` to find macros. This monorepo is the source of a few of
them such as _style.acorn_, _ms.acorn_, and _preval.acorn_. You'll see JS macros
published as `*.macro` but those are strictly for [babel-plugin-macros][1] and
don't work here.

This library is very simple. It processes a single JS code-string and emits a
new JS code-string. Because there's no processing of the JS module graph or
understanding of files on the filesystem, your best bet is to gather your source
code using a tool like [esbuild][2] and process the resulting bundle.

Here's a minimal build script using esbuild with style.acorn:

```ts
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { replaceMacros } from 'acorn-macros';
import { styleMacro } from 'style.acorn';

const buildResult = await esbuild.build({
  entryPoints: ['./index.tsx'],
  // Don't bundle your macros!
  external: ['style.acorn'],
  // Pass to buildResult instead as buildResult.outputFiles
  write: false,
  bundle: true,
});
const [buffer] = buildResult.outputFiles;
const codeOriginal = (new TextDecoder()).decode(buffer.contents);
const codeReplaced = replaceMacros(codeOriginal, [
  styleMacro({
    outFile: './dist/out.css'
  }),
  // You can include other macros here...
]);
fs.writeFileSync('./dist/bundle.js', codeReplaced);
```

Read the build scripts in this repo under _./test/**/esbuild.ts_ for more usage
examples such as combining macros, providing macro options, and using esbuild
plugins to automatically externalize all `*.acorn` imports.

## Design

This does a single AST parse (optional) and walk to collect start/end indices
for any JS identifiers that are imported by a `*.acorn"` import. These imports
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

I wrote this to use my CSS-in-JS macro [styletakeout.macro][3] with esbuild so I
can drop babel and babel-plugin-macros from my toolchain altogether. This work
started as research in another repo called [esbuild-macros][4] which explored
different generic macro-replacement methods such as esbuild plugins, regex
matching, and then finally using acorn-walk.

In a pastlife I would have done a git-filter-branch to pull history to this
repo, but I'm tired; the history is available in the other repo.

## Known Macros

You'll know what work is best handled during compilation - if a macro comes to
mind, try wiring it up! The `ms.acorn` macro is a simple example of how to write
one. I originally saw a usecase to provide the following macros:

Implemented (_Work in progress_):

- __common-tags.acorn__: Uses the [common-tags][5] package to do work on
  strings. Previously named _deindent.acorn_.
- __ms.acorn__: Uses the [ms][6] package to convertion various time formats to
  milliseconds. Inspired by [ms.macro][7].
- __preval.acorn__: Evaluate arbitrary JS in your Node environment. Inspired by
  [preval.macro][8].
- __style.acorn__: Take out CSS from CSS-in-JS. Successor to my previous library
  [styletakeout.macro][3].

Ideas:

- __graphql.acorn__: Swap GQL for the expression result, as Next.js does.
- __intl.acorn__: Swap text for its locale-specific translations.
- __json.acorn__: Swap a JSON expression like [JQ][9] or [JTC][10] for the
  content. Allows importing only specific subsets of huge JSON files.
- __sql.acorn__: Like graphql.acorn.
- __yaml.acorn__: Like json.acorn.

Note that all the above ideas involve swapping JS for data/content, which can be
done today with preval.acorn. It makes sense to break away from preval.acorn
when your macro becomes stateful - in style.acorn this is true because it needs
to do a global collection of styles and write them to disk using `hookPost`. I
don't use GraphQL or SQL right now to know if they'd be worth implementing as
their own macros unless they had more complex logic such as caching.

If you see value in having a macro implemented open an issue and I'll help you
wire it up.

## Future work:

- [ ] Performance metrics to see which macros do what amount of work
- [ ] Patch source maps to reflect the macro-replaced code
- [ ] Improve errors by rethrowing macro errors with useful metadata
- [ ] Improve errors using source maps to show original line/column
- [ ] Simplify template strings i.e: `` `a ${50} b` `` to `"a 50 b"`.
- [ ] Simplify normal strings i.e: `"a" + "b"` to `"ab"`.

[1 ]: https://npmjs.com/package/babel-plugin-macros
[2 ]: https://esbuild.github.io/
[3 ]: https://npmjs.com/package/styletakeout.macro
[4 ]: https://github.com/heyheyhello/esbuild-macros
[5 ]: https://npmjs.com/package/common-tags
[6 ]: https://npmjs.com/package/ms
[7 ]: https://npmjs.com/package/ms.macro
[8 ]: https://npmjs.com/package/preval.macro
[9 ]: https://stedolan.github.io/jq/
[10]: https://github.com/ldn-softdev/jtc
