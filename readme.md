# Replace JS macros with Acorn

This does a single AST pass using acorn-walk to collect start/end indices for JS
identifiers of imports that end in "*.macro". These are evaluated in the correct
order to handle nested macros. Each macro runs via `eval()` allowing for
arbitrary code insertion.

It's fast:

- There's only one (1) AST parse and traversal. Macros are given the AST node to
  determine the start/end indices in the JS code code.
- Macro replacements are then eval'd and applied directly to the JS code string,
  not the AST - there's no AST manipulation or serialization at all.

I wrote this to bring macro support to esbuild, replacing babel-plugin-macros,
and applying me to port and use styletakeout.macro (my CSS-in-JS macro) with
esbuild so I can drop babel from my toolchain altogether.
