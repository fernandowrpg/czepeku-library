#!/usr/bin/env node
// Validação simples antes da release: manifesto coerente e arquivos referenciados existem.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const m = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
const errors = [];
for (const k of ["id", "title", "version", "compatibility"]) if (!m[k]) errors.push(`module.json sem "${k}"`);
for (const f of [...(m.esmodules || []), ...(m.styles || [])]) if (!existsSync(join(root, f))) errors.push(`arquivo não encontrado: ${f}`);
if (m.download && !m.download.includes(`/v${m.version}/`)) errors.push(`download não aponta para v${m.version}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`ok: ${m.id} ${m.version}`);
