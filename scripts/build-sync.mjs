import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "firebase-sync.bundle.js");
await build({ entryPoints: [path.join(root, "firebase-sync-entry.js")], outfile, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, sourcemap: false, legalComments: "none" });
console.log(`Firebase sync bundle generated: ${outfile}`);
