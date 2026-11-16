// Source-type metadata only: no content reads, permissions or retrieval grants.
export const assistantKnowledgeSources = [
 {name:'SOP Library',owner:'Crew Learning',access:'SOP Library permissions and outlet scope; Crew uses employee-bound sessions.',version:'Published versions and pinned assignment snapshots.',readiness:'Assistant retrieval is not connected.'},
 {name:'Production SOP & QC',owner:'Factory',access:'Factory SOP and Production permissions; QC evidence belongs to completed Production.',version:'Versioned SOPs pin Recipe versions; execution retains its SOP and QC evidence.',readiness:'Assistant retrieval is not connected.'},
 {name:'Brand guidance & approved FAQ',owner:'Marketing',access:'Brand membership, role scope and separate knowledge / Inbox permissions.',version:'Revision-controlled brand facts and approved FAQ sources; operational facts require current sources.',readiness:'Marketing retrieval is domain-specific; Native Assistant is not connected.'},
 {name:'Employment documents & contract templates',owner:'People / Legal Entities',access:'Employment Document permissions, employee scope and private document access.',version:'Published template versions and immutable issued document snapshots.',readiness:'Assistant retrieval is not connected.'},
];
