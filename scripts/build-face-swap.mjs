import { build } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "assets", "face-swap");
const pkg = join(root, "node_modules");
const inswapper = join(pkg, "browser-inswapper");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(inswapper, "dist", "index.js")],
  outfile: join(out, "engine.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  external: [],
});

for (const name of ["worker.js", "segment-worker.js"]) {
  await cp(join(inswapper, "dist", name), join(out, name));
}

const ortSrc = join(pkg, "onnxruntime-web", "dist");
const ortOut = join(out, "ort");
await mkdir(ortOut, { recursive: true });
for (const f of await readdir(ortSrc)) {
  if (/\.(wasm|mjs|js)$/i.test(f)) {
    await cp(join(ortSrc, f), join(ortOut, f));
  }
}

const mpSrc = join(pkg, "@mediapipe", "tasks-vision", "wasm");
const mpOut = join(out, "mediapipe");
await mkdir(mpOut, { recursive: true });
await cp(mpSrc, mpOut, { recursive: true });

console.log("DocuWorks Face Swap engine built:", out);
