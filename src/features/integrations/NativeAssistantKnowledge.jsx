import Badge from '../../components/ui/Badge.jsx';

// Readiness metadata only. Documents remain in their domain owners; this registry
// performs no content reads and grants no retrieval or cross-domain authority.
export const assistantKnowledgeSources = [
 {name:'SOP Library',owner:'Crew Learning',access:'SOP Library permissions and outlet scope; Crew uses employee-bound sessions.',version:'Published versions and pinned assignment snapshots.',readiness:'Assistant retrieval is not connected.'},
 {name:'Production SOP & QC',owner:'Factory',access:'Factory SOP and Production permissions; QC evidence belongs to completed Production.',version:'Versioned SOPs pin Recipe versions; execution retains its SOP and QC evidence.',readiness:'Assistant retrieval is not connected.'},
 {name:'Brand guidance & approved FAQ',owner:'Marketing',access:'Brand membership, role scope and separate knowledge / Inbox permissions.',version:'Revision-controlled brand facts and approved FAQ sources; operational facts require current sources.',readiness:'Marketing retrieval is domain-specific; Native Assistant is not connected.'},
 {name:'Employment documents & contract templates',owner:'People / Legal Entities',access:'Employment Document permissions, employee scope and private document access.',version:'Published template versions and immutable issued document snapshots.',readiness:'Assistant retrieval is not connected.'},
];

export default function NativeAssistantKnowledge(){
 return <section className="space-y-5" aria-label="Knowledge readiness">
  <div><h3 className="text-sm font-semibold">Source registry &amp; readiness</h3><p className="mt-1 text-sm text-text-secondary">Existing authorities remain the source of truth. This registry neither copies documents nor enables retrieval.</p></div>
  <dl className="grid gap-4 text-sm sm:grid-cols-3">
   <div><dt className="font-semibold">Live Business Data</dt><dd className="mt-1 text-text-secondary">Authorized tool reads, with source, scope and time. Historical inventory is not current stock.</dd></div>
   <div><dt className="font-semibold">Managed Knowledge</dt><dd className="mt-1 text-text-secondary">Domain-owned SOPs, guidance and documents. Retrieval needs verified access and version checks.</dd></div>
   <div><dt className="font-semibold">Personal Memory</dt><dd className="mt-1 text-text-secondary">User-owned, explicitly saved preferences in Assistant. Not shared knowledge or business evidence.</dd></div>
  </dl>
  <div className="divide-y divide-border">{assistantKnowledgeSources.map(source=><article key={source.name} className="py-4 first:pt-0">
   <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{source.name} <span className="font-normal text-text-secondary">· {source.owner}</span></h4><Badge>Not connected</Badge></div>
   <dl className="grid gap-3 text-xs sm:grid-cols-3"><div><dt className="font-medium">Permission model</dt><dd className="mt-1 text-text-secondary">{source.access}</dd></div><div><dt className="font-medium">Version &amp; freshness</dt><dd className="mt-1 text-text-secondary">{source.version} Current document freshness has not been checked here.</dd></div><div><dt className="font-medium">Retrieval readiness</dt><dd className="mt-1 text-text-secondary">{source.readiness} Source-level access and freshness must be verified before connection.</dd></div></dl>
  </article>)}</div>
  <p className="text-xs text-text-secondary">This is a source-type inventory, not a list of documents you can access. It grants no additional permissions.</p>
 </section>;
}
