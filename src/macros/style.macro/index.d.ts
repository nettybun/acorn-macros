/** Takeout css`` statement is replaced with a string of a unique classname */
export declare function css(statics: TemplateStringsArray, ...variables: string[]): string;
/** Takeout injectGlobal`` statement is removed entirely */
export declare function injectGlobal(statics: TemplateStringsArray, ...variables: string[]): void;

// Use `declare module 'style.macro' { const x: { ... } }` to define type
// support for imports set in styleMacro's `importObject` option.
