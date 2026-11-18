import { build } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const out = join(root, "assets", "face-swap");
const cache = join(root, ".face-swap-build", "browser-inswapper");

await rm(out, { recursive: true, force: true });
await rm(join(root, ".face-swap-build"), { recursive: true, force: true });
await mkdir(out, { recursive: true });
await mkdir(join(root, ".face-swap-build"), { recursive: true });

console.log("Fetching browser-inswapper source...");
await exec("git", ["clone", "--depth", "1", "https://github.com/robert-schmidt/browser-inswapper.git", cache]);

console.log("Installing browser-inswapper build dependencies...");
await exec("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: cache });

console.log("Building browser-inswapper...");
await exec("npm", ["run", "build"], { cwd: cache });

const pkg = join(cache, "node_modules");

await build({
  entryPoints: [join(cache, "dist", "index.js")],
  outfile: join(out, "engine.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: true,
  legalComments: "none",
});

for (const name of ["worker.js", "segment-worker.js"]) {
  await cp(join(cache, "dist", name), join(out, name));
}

const ortSrc = join(pkg, "onnxruntime-web", "dist");
const ortOut = join(out, "ort");
await mkdir(ortOut, { recursive: true });
for (const f of await readdir(ortSrc)) {
  if (/\.(wasm|mjs|js)$/i.test(f)) await cp(join(ortSrc, f), join(ortOut, f));
}

const mpSrc = join(pkg, "@mediapipe", "tasks-vision", "wasm");
const mpOut = join(out, "mediapipe");
await mkdir(mpOut, { recursive: true });
await cp(mpSrc, mpOut, { recursive: true });

await rm(join(root, ".face-swap-build"), { recursive: true, force: true });

console.log("DocuWorks Face Swap engine built:", out);
