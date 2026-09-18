// One-time migration from the repository's published HTML. Only read literal AST
// values; never execute the bundled application or third-party script content.
import fs from 'node:fs';
import { parseAst } from 'rollup/parseAst';

const html = fs.readFileSync(process.argv[2] || 'dist/index.html', 'utf8');
const code = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!code) throw new Error('Missing module script');
const declarations = new Map(parseAst(code).body.flatMap((node) => node.type === 'VariableDeclaration' ? node.declarations.map((d) => [d.id.name, d.init]) : []));
function literal(node) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map((p) => {
    if (p.type !== 'Property' || p.computed || p.kind !== 'init') throw new Error('Not a literal property');
    return [p.key.name ?? p.key.value, literal(p.value)];
  }));
  if (node.type === 'UnaryExpression' && node.operator === '-') return -literal(node.argument);
  throw new Error(`Not a literal: ${node.type}`);
}
// Names verified against upstream a12a7d3's checked-in dist/index.html.
const snapshot = {
  activityManifests: literal(declarations.get('rt')),
  caseMedia: literal(declarations.get('Nd')),
  aichongCases: literal(declarations.get('Ud')),
  socialLinks: literal(declarations.get('Vd')),
};
if (snapshot.activityManifests.filter((e) => e.id !== '04-2').length !== 34) throw new Error('Unexpected published archive');
fs.writeFileSync('src/data/siteContent.snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log('Saved published activity, case, tag and social-link snapshot.');
