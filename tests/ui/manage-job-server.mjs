// Isolated component gallery: real UI components, fake service boundaries, no production credentials.
import { build } from 'esbuild';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const realComponents = /\/(JobsPage|CompactJobSection|JobsiteGpsVerification|JobTimeSummary|JobCalendarStatus|JobMileageSummary|JobLaborSummary|PhotoUploader|PhotoCaptureQueue|PhotoGallery|PhotoViewerModal)$/;
const plugin = { name: 'isolated-services', setup(bundler) {
  bundler.onLoad({ filter: /[\\/]components[\\/]jobs[\\/]JobsPage\.tsx$/ }, async args => ({ contents: (await readFile(args.path,'utf8')).replace('function JobModal({','export function JobModal({').replace('function JobCard({','export function JobCard({'), loader:'tsx', resolveDir:resolve('components/jobs') }));
  bundler.onResolve({ filter: /^@\/(lib\/services\/|components\/|lib\/geo\/currentPosition)/ }, async args => {
    if (realComponents.test(args.path)) return;
    const source=ts.createSourceFile(args.importer,await readFile(args.importer,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const names=source.statements.filter(ts.isImportDeclaration).filter(n=>n.moduleSpecifier.text===args.path).flatMap(n=>n.importClause?.namedBindings?.elements??[]).filter(n=>!n.isTypeOnly).map(n=>n.propertyName?.text??n.name.text);
    return { path:JSON.stringify({path:args.path,names}),namespace:'fixture' };
  });
  bundler.onLoad({ filter:/.*/,namespace:'fixture' },args=>{
    const {path,names}=JSON.parse(args.path);
    return { contents:names.map(name=>`export const ${name} = ${path.startsWith('@/components/') ? name==='useAuth' ? '()=>({profile:{id:"user",role:"Master Admin"},loading:false})' : name.startsWith('use') ? '()=>({})' : '()=>null' : name.endsWith('_EVENT') ? JSON.stringify(name) : `(...args)=>window.fixture.call(${JSON.stringify(name)},...args)`};`).join('\n'),loader:'js' };
  });
}};
const result=await build({entryPoints:['tests/ui/manage-job-gallery.jsx'],bundle:true,write:false,jsx:'automatic',tsconfig:'tsconfig.json',plugins:[plugin],define:{'process.env.NODE_ENV':'"development"'}});
const css=await postcss([tailwind()]).process(await readFile('app/globals.css','utf8'),{from:resolve('app/globals.css')});
createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].text);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css);}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
}).listen(4179,'127.0.0.1',()=>console.log('Manage Job gallery ready on 127.0.0.1:4179'));
