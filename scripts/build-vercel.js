import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../dist/", import.meta.url));

rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "settings.html", "styles.css", "config.js"]) {
  cpSync(`${root}${file}`, `${output}${file}`);
}
cpSync(`${root}src`, `${output}src`, { recursive: true });
