import { preval } from 'preval.acorn';

const content = preval`
  const fs = await import('fs');
  return {
    val: fs.readFileSync('./content.md', 'utf8'),
    lineCount() { return content.val.split("\\n").length; }
  };
` as { val: string, lineCount: () => number };

console.log(content.val);
console.log(content.lineCount());
