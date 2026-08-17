import fs from "fs";
import path from "path";
import * as parser from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;

// Resolves calls like `t(I18N_KEYS.PAGES.SOME_KEY)` back to the literal string
// value assigned in the imported constants object — this is confirmed to be
// the DOMINANT pattern in real campaign-manager code (1,595 calls vs 527 raw
// string literals in one real check). Unlike a true runtime value (e.g. a
// template literal interpolating a variable), this is fully static: the
// constants object is a plain JS object in another file, so its values are
// knowable without running the app.
//
// Deliberately does NOT assume property name === string value — confirmed
// against real data that ~4 in 999 entries diverge (including at least one
// outright typo), so the actual assigned value must be resolved, not guessed
// from the property name.

const CANDIDATE_EXTENSIONS = ["", ".js", ".jsx", "/index.js", "/index.jsx"];
const fileConstantsCache = new Map(); // absolute file path -> { exportedName: nestedValueTree }

function resolveImportPath(fromFile, importPath) {
  if (!importPath.startsWith(".")) return null; // only local/relative imports are resolvable this way
  const base = path.resolve(path.dirname(fromFile), importPath);
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function objectExpressionToValueTree(node) {
  const tree = {};
  for (const prop of node.properties) {
    if (prop.type !== "ObjectProperty" || prop.computed) continue;
    const keyName =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : null;
    if (!keyName) continue;
    if (prop.value.type === "StringLiteral") {
      tree[keyName] = prop.value.value;
    } else if (prop.value.type === "ObjectExpression") {
      tree[keyName] = objectExpressionToValueTree(prop.value);
    }
  }
  return tree;
}

function getExportedConstants(absFilePath) {
  if (fileConstantsCache.has(absFilePath)) return fileConstantsCache.get(absFilePath);

  const exportsMap = {};
  try {
    const code = fs.readFileSync(absFilePath, "utf8");
    const ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["jsx", "classProperties", "objectRestSpread"],
    });
    traverse(ast, {
      ExportNamedDeclaration(pathNode) {
        const decl = pathNode.node.declaration;
        if (!decl || decl.type !== "VariableDeclaration") return;
        for (const declarator of decl.declarations) {
          if (declarator.id.type === "Identifier" && declarator.init?.type === "ObjectExpression") {
            exportsMap[declarator.id.name] = objectExpressionToValueTree(declarator.init);
          }
        }
      },
    });
  } catch {
    // unparsable or unreadable — cache the empty result so we don't retry on every call site
  }

  fileConstantsCache.set(absFilePath, exportsMap);
  return exportsMap;
}

// Builds { localName: { importPath, importedName } } for a file's named
// imports — e.g. `import { I18N_KEYS } from "../../utils/i18nKeyConstants"`.
// Default/namespace imports aren't handled — not the pattern seen in practice.
export function buildImportMap(ast) {
  const importMap = {};
  traverse(ast, {
    ImportDeclaration(pathNode) {
      const source = pathNode.node.source.value;
      pathNode.node.specifiers.forEach((spec) => {
        if (spec.type === "ImportSpecifier") {
          importMap[spec.local.name] = { importPath: source, importedName: spec.imported.name };
        }
      });
    },
  });
  return importMap;
}

// Given the importing file's path, its import map, and a MemberExpression AST
// node, attempts to resolve the full chain to a literal string. Returns null
// (not an error) whenever resolution isn't possible — callers should treat
// null the same as "genuinely dynamic," not as a bug.
export function resolveMemberExpressionKey(sourceFile, importMap, memberExpressionNode) {
  const chain = [];
  let node = memberExpressionNode;
  while (node.type === "MemberExpression") {
    if (node.computed) return null; // e.g. I18N_KEYS[someVar] — genuinely dynamic, not resolvable
    if (node.property.type !== "Identifier") return null;
    chain.unshift(node.property.name);
    node = node.object;
  }
  if (node.type !== "Identifier") return null;

  const binding = importMap[node.name];
  if (!binding) return null;

  const absPath = resolveImportPath(sourceFile, binding.importPath);
  if (!absPath) return null;

  const exportsMap = getExportedConstants(absPath);
  let value = exportsMap[binding.importedName];
  for (const segment of chain) {
    if (value == null || typeof value !== "object") return null;
    value = value[segment];
  }
  return typeof value === "string" ? value : null;
}
