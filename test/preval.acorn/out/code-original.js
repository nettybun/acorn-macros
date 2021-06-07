// input.ts
import {preval} from "preval.acorn";
var content = preval`
  const fs = await import('fs');
  return {
    val: fs.readFileSync('./content.md', 'utf8'),
    lineCount() { return content.val.split("\\n").length; }
  };
`;
console.log(content.val);
console.log(content.lineCount());
