import { preval } from 'preval.acorn';

const content = preval`
  // By default 'fs/promises' and 'path' are imported
  return {
    val: await fs.readFile('./content.md', 'utf8'),
    lineCount() { return content.val.split("\\n").length; }
  };
` as { val: string, lineCount: () => number };

// Network requests at build time and handling ${} via pre-call processing step
preval`
  console.log('✨ Fetching PNG ✨');
  console.log('✨ Template string processing: ${process.platform}');
  const fetch = (await import('node-fetch')).default;
  fetch('https://placekitten.com/200/200')
    .then(res => res.buffer())
    .then(buffer => fs.writeFile('./out/cat.png', buffer));
  return 'console.log("Cat pic at ./out/cat.png")';
`;

console.log(content.val);
console.log(content.lineCount());
