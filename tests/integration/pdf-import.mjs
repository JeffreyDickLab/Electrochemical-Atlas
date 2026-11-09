/**
 * Real book-import regression, using a PDF supplied by the developer/user.
 * Does not copy or distribute any pages or text. Runs entirely under Node.
 *
 * ATLAS_TEST_PDF=/path/to/original.pdf node tests/integration/pdf-import.mjs
 */
import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {runInThisContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path = process.env.ATLAS_TEST_PDF;
if (!path) throw new Error('Set ATLAS_TEST_PDF to a user-supplied original PDF');
const app = resolve('app');
globalThis.window = globalThis;
for (const name of ['text-utils.js', 'pdf-core.js', 'runtime-catalog.js']) {
  runInThisContext(await readFile(join(app,name),'utf8'), {filename:name});
}
runInThisContext(await readFile(resolve('src/client/equations/catalog.js'),'utf8'), {filename:'equation-catalog.js'});
const {reconcile}=globalThis.AtlasEquationIndex;
const bytes=await readFile(resolve(path));
const pdf=new File([bytes], 'original.pdf',{type:'application/pdf'});
const engine=await new globalThis.AtlasPDFCore.PDFLite(pdf).init(()=>{});
const result=await globalThis.AtlasRuntimeCatalog.build(engine,()=>{});
const sha=createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile(join(app,'equations/source-map.json'),'utf8'));
assert.equal(result.pages.length,1107);
assert.equal(sha,manifest.pdf_sha256,'Wrong edition for source-matched equation test');
assert.equal(reconcile(result, manifest, sha), true);
assert.equal(result.catalog.equations.length,2004);
assert.ok(result.catalog.sections.length>300);
for (const label of ['1.3.22','1.3.23','1.3.24','1.5.1']) {
  assert.ok(result.catalog.equations.find(e=>e.label===label),`Missing ${label}`);
}
console.log(`Imported ${result.pages.length} pages, ${result.catalog.sections.length} sections and ${result.catalog.equations.length} verified equation references from the matching PDF.`);
