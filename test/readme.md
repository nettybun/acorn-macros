# Testing

TODO: Only implemented for style.macro and ms.macro right now...

Need a test example for each macro. They can all share the same input file which
will make use of all macros but each test will only operate on that single
macro. Then an also need an "all" test.

```
deindent.macro/
  out/
  esbuild.ts
graphql.macro/
  out/
  esbuild.ts
intl.macro/
  out/
  esbuild.ts
json.macro/
  out/
  esbuild.ts
ms.macro/
  out/
  esbuild.ts
preval.macro/
  out/
  esbuild.ts
sql.macro/
  out/
  esbuild.ts
style.macro/
  out/
  esbuild.ts
yaml.macro/
  out/
  esbuild.ts
all/
  out/
  esbuild.ts
readme.md
entrypoint.ts
```
