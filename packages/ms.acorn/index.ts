throw new Error('Importing ms.acorn at runtime isn\'t supported. '
  + 'Use replaceMacros() from acorn-macros to preprocess your code.');

/** Converts a time string (s/m/h/d/w/y) to a number of milliseconds */
export declare function ms(time: string): number;
