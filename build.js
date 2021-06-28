import fs from 'fs/promises';
import esbuild from 'esbuild';

const promises = [];

function build(filePath) {
  console.log(filePath);
  const buildTask = esbuild.build({
    entryPoints: [filePath],
    outfile: filePath.replace('.ts', '.js'),
  });
  promises.push(buildTask);
}
for (const dirName of await fs.readdir('./packages')) {
  for (const fileName of await fs.readdir(`./packages/${dirName}`)) {
    if (fileName.endsWith('.d.ts') || !fileName.endsWith('.ts')) continue;
    build(`./packages/${dirName}/${fileName}`);
  }
}
await Promise.all(promises);
