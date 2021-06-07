throw new Error('Importing preval.acorn at runtime isn\'t supported. '
  + 'Use replaceMacros() from acorn-macros to preprocess your code.');

/** Runs Node.js code at compile time */
export declare function preval(code: string): unknown;
export declare function preval(statics: TemplateStringsArray, ...variables: string[]): unknown;
