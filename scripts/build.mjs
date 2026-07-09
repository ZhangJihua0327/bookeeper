import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const serverFiles = ["config.ts", "feishu.ts", "report.ts", "index.ts"];
const publicFiles = ["index.html", "styles.css"];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/public", { recursive: true });

for (const file of serverFiles) {
  await compileTs(join("src/server", file), join("dist/server", file.replace(/\.ts$/, ".js")));
}

await compileTs("src/public/app.ts", "dist/public/app.js");
for (const file of publicFiles) {
  await copyFile(join("src/public", file), join("dist/public", file));
}

async function compileTs(input, output) {
  const source = await readFile(input, "utf8");
  const js = stripTypeScriptTypes(source, { mode: "strip", sourceUrl: input });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, js, "utf8");
}
