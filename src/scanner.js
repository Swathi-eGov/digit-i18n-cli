import fs from "fs";
import * as parser from "@babel/parser";
import traverseModule from "@babel/traverse";
import { glob } from "glob";
import { buildImportMap, resolveMemberExpressionKey } from "./keyConstantsResolver.js";

// ESM/CJS interop: @babel/traverse's default export lands differently
// depending on how Node resolves it.
const traverse = traverseModule.default || traverseModule;

const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/*.min.js"];

export async function findSourceFiles(pattern = "**/*.{js,jsx}", cwd = process.cwd()) {
  return glob(pattern, { cwd, ignore: DEFAULT_IGNORE, absolute: true, nodir: true });
}

// Extracts every `t(...)` call site from one file. Two argument shapes
// resolve to a static key:
//   1. A plain string literal — t("SOME_KEY")
//   2. A member-expression reference into an imported constants object —
//      t(I18N_KEYS.PAGES.SOME_KEY) — confirmed to be the DOMINANT pattern in
//      real campaign-manager code (1,595 calls vs 527 raw literals in one
//      check). This is resolved by parsing the imported file and looking up
//      the actual assigned string (never assumed from the property name —
//      confirmed some entries diverge from name==value, including a real typo).
// Anything else (template literals with variables, computed member access,
// etc.) is genuinely dynamic and reported as such, not silently dropped (see
// docs/TECHNICAL_DOC.md §9, Known limitations).
export function scanFileForKeys(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const results = [];
  const dynamic = [];

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["jsx", "classProperties", "objectRestSpread", "optionalChaining", "nullishCoalescingOperator"],
    });
  } catch (err) {
    return { error: err.message, results: [], dynamic: [] };
  }

  const importMap = buildImportMap(ast);

  traverse(ast, {
    CallExpression(pathNode) {
      const callee = pathNode.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "t") return;

      const firstArg = pathNode.node.arguments[0];
      const line = firstArg?.loc?.start?.line ?? pathNode.node.loc?.start?.line ?? null;

      if (!firstArg) return;

      if (firstArg.type === "StringLiteral") {
        results.push({ key: firstArg.value, file: filePath, line });
        return;
      }

      if (firstArg.type === "MemberExpression") {
        const resolved = resolveMemberExpressionKey(filePath, importMap, firstArg);
        if (resolved !== null) {
          results.push({ key: resolved, file: filePath, line, viaConstants: true });
          return;
        }
      }

      // Key built from a runtime expression (template literal, variable,
      // computed member access, or an import we couldn't resolve/parse) —
      // can't be resolved statically. Report it as a gap, not a silent drop.
      dynamic.push({ file: filePath, line });
    },
  });

  return { error: null, results, dynamic };
}

export async function scanFilesForKeys(files) {
  const all = [];
  const dynamicAll = [];
  const errors = [];
  for (const file of files) {
    const { error, results, dynamic } = scanFileForKeys(file);
    if (error) {
      errors.push({ file, error });
      continue;
    }
    all.push(...results);
    dynamicAll.push(...dynamic);
  }
  return { entries: all, dynamic: dynamicAll, errors };
}
