// Turns dist-demo/index.html into a page fragment for publishing as a shared
// artifact: the host supplies <!doctype>, <html>, <head> and <body> itself,
// so keep only the title, styles, scripts and body content.
import { readFileSync, writeFileSync } from "node:fs";

const src = "dist-demo/index.html";
const out = "dist-demo/sat-measure-demo.html";
const html = readFileSync(src, "utf8");

const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";
if (!head || !body) throw new Error(`Couldn't find <head> and <body> in ${src}`);

const keptHead = head.replace(/<meta[^>]*>\s*/gi, "").trim();
writeFileSync(out, `${keptHead}\n${body.trim()}\n`);
console.log(`Wrote ${out} (${(Buffer.byteLength(keptHead + body) / 1024).toFixed(0)} KB)`);
