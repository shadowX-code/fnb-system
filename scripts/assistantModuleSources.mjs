import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {parseAst} from 'vite';
import {resolveCanonicalPath} from '../src/app/routeOwnership.js';

const routeFile='src/app/routes.jsx';
const parse=source=>parseAst(source,{jsx:true});
const local=(file,relative)=>relative?.startsWith('.')?path.normalize(path.join(path.dirname(file),relative)):null;
function visit(node,fn){
 if(!node?.type)return;
 fn(node);
 for(const value of Object.values(node)){
  if(Array.isArray(value))value.forEach(child=>visit(child,fn));
  else if(value?.type)visit(value,fn);
 }
}

// Domain reads can select an owner RPC by a fixed register name or call it
// through a local helper. Direct caller.rpc('name') inspection misses both.
export function domainSqlNames(source){
 const literals=new Set();
 visit(parse(source),node=>{
  if(node.type==='Literal'&&typeof node.value==='string'&&/^[a-z][a-z0-9_]*$/.test(node.value))literals.add(node.value);
 });
 return literals;
}
export function referencedPublicFunctions(sql,domainNames){
 return [...sql.matchAll(/\b(?:create\s+(?:or\s+replace\s+)?function|alter\s+function|drop\s+function(?:\s+if\s+exists)?|on\s+(?:function|routine))\s+"?public"?\s*\.\s*"?([a-z][a-z0-9_]*)"?\s*\(/gi)]
  .map(match=>match[1].toLowerCase()).filter(name=>domainNames.has(name));
}
function importsOf(ast){
 const imports=new Map();
 for(const statement of ast.body){
  if(statement.type==='ImportDeclaration')for(const spec of statement.specifiers){
   imports.set(spec.local.name,{source:statement.source.value,export:spec.imported?.name??(spec.type==='ImportNamespaceSpecifier'?'*':'default')});
  }
  for(const decl of (statement.declaration??statement).declarations??[]){
   const init=decl.init,source=init?.callee?.name==='lazy'&&init.arguments[0]?.body?.source?.value;
   if(source)imports.set(decl.id.name,{source,export:'default'});
  }
 }
 return imports;
}
const property=(obj,name)=>obj?.properties?.find(p=>(p.key?.name??p.key?.value)===name)?.value;
export function routeAssemblySignature(source){
 const ast=parse(source);
 const assembled=ast.body.flatMap(s=>(s.declaration??s).declarations??[]).find(d=>d.id.name==='salesPurchaseRoutes')?.init;
 if(!assembled)throw Error('Review the Admin route assembly.');
 // Retain filters, fallback permission, selected component and forwarded props.
 // Only presentation fields in the output record are exempt.
 visit(assembled,node=>{
  if(node.type==='ObjectExpression')node.properties=node.properties.filter(p=>
   !['label','eyebrow','description','moduleLabel'].includes(p.key?.name));
 });
 return semanticNode(assembled);
}
function readRoutes(source){
 const ast=parse(source),imports=importsOf(ast);
 const details=ast.body.flatMap(s=>(s.declaration??s).declarations??[]).find(d=>d.id.name==='routeDetails')?.init;
 if(details?.type!=='ObjectExpression')throw Error('Review the Admin route owner mapping.');
 const routes=new Map();
 for(const entry of details.properties){
  const id=entry.key?.name??entry.key?.value;
  if(!id||entry.value?.type!=='ObjectExpression')throw Error('Review dynamic Admin route ownership.');
  const component=property(entry.value,'component')?.name;
  if(!component)continue;
  const ref=imports.get(component),file=local(routeFile,ref?.source);
  if(!file||!existsSync(file))throw Error('Cannot trace Admin component '+component);
  const routeProps=property(entry.value,'props'),permission=property(entry.value,'permission');
  if(routeProps&&routeProps.type!=='ObjectExpression'||permission&&permission.type!=='Literal')throw Error('Review dynamic props or permissions for '+id);
  const props=Object.fromEntries((routeProps?.properties??[]).map(p=>{
   if(p.value?.type!=='Literal')throw Error('Review dynamic Admin route props for '+id);
   return [p.key.name??p.key.value,p.value.value];
  }));
  routes.set(id,{file,component:ref.export,props,permission:permission?.value??null});
 }
 return routes;
}
const routeSource=readFileSync(routeFile,'utf8');
const routes=readRoutes(routeSource);
export const registeredRouteBindings={routes:[...routes],assembly:routeAssemblySignature(routeSource)};

// Match data-owner imports and direct access to the authenticated client.
// Hash call targets/arguments, including field, date and permission predicates.
// Presentation text, classes and unrelated JSX do not participate in this signature.
const dataImport=source=>/(?:\/(?:services|api|data|models|queries|selectors)\/|(?:Service|Repository|Model|Query|Queries|Selector|SupabaseClient)\.[cm]?[jt]sx?$|\/supabase(?:Client)?(?:\.|$))/i.test(source);
const storeField=node=>node.type==='MemberExpression'&&node.object?.name==='store'&&
 (node.computed?node.property.value:node.property.name);
const dataHooks=new Map();
function dataBinding(file,source){
 if(dataImport(source))return true;
 const hook=local(file,source);
 if(!hook?.includes('/hooks/')||!hook.match(/\.[cm]?jsx?$/)||!existsSync(hook))return false;
 if(!dataHooks.has(hook)){
  const ast=parse(readFileSync(hook,'utf8')),imported=importsOf(ast);
  let readsStore=false;
  visit(ast,node=>{if(storeField(node))readsStore=true;});
  dataHooks.set(hook,readsStore||[...imported.values()].some(ref=>dataImport(ref.source)||/(?:Data|Permissions?|Access)Context\.[cm]?jsx?$/i.test(ref.source)));
 }
 return dataHooks.get(hook);
}
function semanticNode(node){
 if(Array.isArray(node))return node.map(semanticNode);
 if(!node||typeof node!=='object')return node;
 if(node.type?.startsWith('JSX'))return {type:node.type};
 return Object.fromEntries(Object.entries(node).filter(([key])=>!['start','end','loc','raw','range','comments'].includes(key))
  .map(([key,value])=>[key,semanticNode(value)]));
}
function callRoot(node){
 if(node?.type==='Identifier')return node.name;
 if(node?.type==='MemberExpression')return callRoot(node.object);
 if(node?.type==='CallExpression')return callRoot(node.callee);
 if(node?.type==='ChainExpression')return callRoot(node.expression);
 return null;
}
function selectedComponent(jsx,imports,file){
 const opening=jsx?.openingElement;
 const name=opening?.attributes?.find(attr=>attr.name?.name==='Page')?.value?.expression?.name??opening?.name?.name;
 const child=local(file,imports.get(name)?.source);
 return child?.endsWith('.jsx')?child:null;
}
function presentation(ast,file){
 const imports=importsOf(ast),declared=new Map([...imports].filter(([,ref])=>dataBinding(file,ref.source)));
 const calls=new Set(),storeFields=new Set(),forwarded=[],branches=[];
 visit(ast,node=>{
  const field=storeField(node);
  if(field)storeFields.add(field);
  if(node.type==='CallExpression'){
   const method=node.callee.property?.name??node.callee.name;
   const permission=['can','hasPermission','hasAnyPermission','canAccessOutlet'].includes(method)&&node.arguments.some(arg=>arg.type==='Literal');
   if(permission||declared.has(callRoot(node))&&!['then','catch','finally','map','filter','reduce','forEach'].includes(method))
    calls.add(JSON.stringify(semanticNode(node)));
  }
  if(node.type==='JSXOpeningElement'){
   const child=local(file,imports.get(node.name.name)?.source);
   if(!child?.endsWith('.jsx')||!child.startsWith('src/features/'))return;
   for(const attr of node.attributes){
    if(attr.type==='JSXSpreadAttribute'&&attr.argument?.name==='props')forwarded.push({key:'*',child});
    if(attr.type==='JSXAttribute'&&attr.value?.expression?.name===attr.name.name)forwarded.push({key:attr.name.name,child});
   }
  }
  if(node.type==='FunctionDeclaration'&&/^[A-Z]/.test(node.id?.name)&&node.params[0]?.type==='ObjectPattern'){
   const props=new Set(node.params[0].properties.map(p=>p.key?.name));
   const statements=node.body.body;
   const selectors=statements.filter(s=>s.type==='IfStatement'&&s.test.operator==='==='&&
    props.has(s.test.left?.name)&&s.test.right?.type==='Literal'&&s.consequent.type==='ReturnStatement');
   for(const clause of selectors){
    const jsx=clause.consequent.argument;
    const child=selectedComponent(jsx,imports,file);
    const render=jsx?.children?.find(node=>node.expression?.type==='CallExpression')?.expression.callee;
    const callback=render?.type==='MemberExpression'&&render.object.name&&render.property.name&&render.object.name+'.'+render.property.name;
    if(child||callback)branches.push({key:clause.test.left.name,value:clause.test.right.value,child,callback});
   }
   const last=statements.at(-1);
   const fallback=last?.type==='ReturnStatement'&&selectedComponent(last.argument,imports,file);
   if(fallback)for(const key of new Set(selectors.map(s=>s.test.left.name))){
    branches.push({key,excluded:selectors.filter(s=>s.test.left.name===key).map(s=>s.test.right.value),child:fallback});
   }
  }
 });
 return {signature:{imports:[...declared].map(([name,ref])=>[name,ref.source,ref.export]).sort(),calls:[...calls].sort(),store:[...storeFields].sort()},
  dependencies:[...declared.values()].map(ref=>local(file,ref.source)).filter(p=>p&&/\.[cm]?[jt]s$/.test(p)&&existsSync(p)),
  forwarded,branches};
}
export const presentationBindings=(source,file)=>presentation(parse(source),file).signature;
const views=new Map();
function view(file){
 if(!views.has(file))views.set(file,presentation(parse(readFileSync(file,'utf8')),file));
 return views.get(file);
}
export const readBindingSignature=file=>view(file).signature;
export const boundDomainFiles=file=>view(file).dependencies;

// These internal resources share an Admin surface rather than a routable URL.
const embeddedRoutes={platform_customers:'marketing_audience',platform_organizations:'marketing_brand_access',crew_cash_deposit:'crew_cash_checkout'};
export function adminModuleBinding(module){
 const route=routes.has(module.id)?module.id:resolveCanonicalPath(module.route)?.definition.routeId??embeddedRoutes[module.id];
 const binding=routes.get(route);
 if(!binding)throw Error('Review the Admin source for '+module.id);
 const owners=new Set(),callbacks=new Set(),via=new Set([binding.file]);
 for(const [key,value] of Object.entries(binding.props)){
  const seen=new Set();
  function follow(file){
   if(seen.has(file))return false;
   seen.add(file);
   const scanned=view(file);
   const branch=scanned.branches.filter(b=>b.key===key&&(b.value===value||b.excluded&&!b.excluded.includes(value)));
   if(branch.length){
    via.add(file);
    for(const b of branch){if(b.child)owners.add(b.child);else callbacks.add(b.callback);}
    return true;
   }
   let found=false;
   for(const edge of scanned.forwarded)if((edge.key===key||edge.key==='*')&&follow(edge.child))found=true;
   if(found)via.add(file);
   return found;
  }
  follow(binding.file);
 }
 return {route,...binding,owners:[...owners].sort(),callbacks:[...callbacks].sort(),via:[...via].sort()};
}
export function adminModuleSource(module){
 const {file,owners}=adminModuleBinding(module);
 return owners.length===1?owners[0]:file;
}
