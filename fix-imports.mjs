import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find all .ts files in src/
const files = await glob('src/**/*.ts', { cwd: __dirname });

let totalFixed = 0;

for (const file of files) {
  const fullPath = path.join(__dirname, file);
  let content = fs.readFileSync(fullPath, 'utf8');
  let modified = false;
  
  // Replace .js with .ts in relative imports (starting with ./ or ../)
  // Pattern: from "path.js" or from 'path.js'
  const newContent = content.replace(
    /from\s+['"](\.\.?\/[^'"]+)\.js['"]/g,
    (match, importPath) => {
      modified = true;
      return `from '${importPath}.ts'`;
    }
  );
  
  if (modified) {
    fs.writeFileSync(fullPath, newContent, 'utf8');
    totalFixed++;
    console.log(`Fixed: ${file}`);
  }
}

console.log(`\nDone! Fixed ${totalFixed} files.`);

