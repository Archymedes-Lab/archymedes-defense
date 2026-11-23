/**
 * Static analysis gate for lib/aero (run: bun scripts/aero_static.ts). Uses the TypeScript compiler API.
 *
 *  S1 purity        lib/aero imports only its own modules, the aero data files, and type-only modules; no React,
 *                   Next, node:*, network or filesystem, so the engine is deterministic and runs anywhere.
 *  S2 determinism   no Math.random, Date, performance, setTimeout or crypto in lib/aero.
 *  S3 no escape     no `any`, no non-null assertions (x!), no `as` casts except `as const` (units.ts is the
 *                   one place allowed to brand numbers).
 *  S4 strict eq     no == or !=.
 *  S5 angle units   a parameter named like an angle (alpha, sweep, angle, aoa) must be typed Rad or Deg.
 *  S6 tested API    every exported function or constant of lib/aero is referenced by a tests/aero*.test.ts file.
 *  S7 live proofs   the @ts-expect-error unit proofs in units.typecheck.ts really fail when the directives are
 *                   removed (a mutation check: if units stop being branded, this rule fails).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "lib/aero");
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => join(DIR, f));
const testSrc = readdirSync(join(ROOT, "tests")).filter((f) => /^aero.*\.test\.ts$/.test(f))
  .map((f) => readFileSync(join(ROOT, "tests", f), "utf8")).join("\n");
const problems: string[] = [];
const ALLOWED_IMPORT = /^(\.\/[a-z0-9-]+|\.\.\/data\/aero-(corpus|validation)\.json)$/;
const BANNED_CALLS = new Set(["Math.random", "Date.now", "performance.now", "setTimeout", "setInterval", "crypto.getRandomValues"]);
const ANGLE_NAME = /^(alpha|alphas|sweep|sweepLe|angle|aoa)$/i;
const exported: { file: string; name: string }[] = [];

for (const file of files) {
  const rel = file.slice(ROOT.length);
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const at = (n: ts.Node) => `${rel}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
  const isUnits = rel.endsWith("units.ts"), isProof = rel.endsWith(".typecheck.ts");
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const m = n.moduleSpecifier.text;
      if (!ALLOWED_IMPORT.test(m)) problems.push(`S1 ${at(n)} imports "${m}"`);
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const e = n.expression.getText(src);
      if (BANNED_CALLS.has(e) || (ts.isNewExpression(n) && e === "Date")) problems.push(`S2 ${at(n)} uses ${e}`);
    }
    if (n.kind === ts.SyntaxKind.AnyKeyword) problems.push(`S3 ${at(n)} uses any`);
    if (ts.isNonNullExpression(n)) problems.push(`S3 ${at(n)} non-null assertion`);
    if (ts.isAsExpression(n) && !isUnits) {
      const t = n.type.getText(src);
      if (t !== "const" && !isProof) problems.push(`S3 ${at(n)} cast "as ${t}"`);
    }
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)) {
      problems.push(`S4 ${at(n)} loose equality`);
    }
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && ANGLE_NAME.test(n.name.text)) {
      const t = n.type?.getText(src) ?? "(untyped)";
      if (!/\b(Rad|Deg)\b/.test(t)) problems.push(`S5 ${at(n)} angle parameter "${n.name.text}" typed ${t}`);
    }
    if (!isProof && (ts.isFunctionDeclaration(n) || ts.isVariableStatement(n) || ts.isClassDeclaration(n)) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const names = ts.isVariableStatement(n) ? n.declarationList.declarations.map((d) => d.name.getText(src)) : [n.name?.getText(src) ?? ""];
      for (const name of names) exported.push({ file: rel, name });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
for (const { file, name } of exported) {
  if (!new RegExp(`\\b${name}\\b`).test(testSrc)) problems.push(`S6 ${file} export "${name}" is not referenced by tests/aero*.test.ts`);
}

// S7: strip the directives from the proof file and type-check it in memory; every proof line must now fail.
const proofPath = join(DIR, "units.typecheck.ts");
const proofSrc = readFileSync(proofPath, "utf8");
const expected = (proofSrc.match(/^\/\/ @ts-expect-error/gm) ?? []).length;
const stripped = proofSrc.replace(/^\/\/ @ts-expect-error.*$/gm, "");
const host = ts.createCompilerHost({ strict: true, noEmit: true, resolveJsonModule: true, esModuleInterop: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true });
const readFile = host.readFile.bind(host);
host.readFile = (f) => (f === proofPath ? stripped : readFile(f));
const program = ts.createProgram([proofPath], { strict: true, noEmit: true, resolveJsonModule: true, esModuleInterop: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true }, host);
const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === proofPath);
if (expected < 6) problems.push(`S7 expected at least 6 unit proofs, found ${expected}`);
if (errs.length < expected) problems.push(`S7 only ${errs.length} of ${expected} unit proofs fail without their directive: units are no longer enforced`);

for (const p of problems) console.log(p);
console.log(`aero static: ${files.length} files, ${exported.length} exports, ${expected} unit proofs (${errs.length} live), ${problems.length} problems`);
process.exit(problems.length > 0 ? 1 : 0);
