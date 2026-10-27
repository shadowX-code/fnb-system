import {useEffect,useState} from 'react';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {adAccountDeclarationName} from './adsCreateModel.js';

export default function AdAccountDeclarations({accountId,form,onChange,disabled,revealReferences=false}) {
 const name=adAccountDeclarationName(accountId);
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{if(revealReferences)setExpanded(true);},[revealReferences]);
 return <section className="border-t border-border pt-4 space-y-3" aria-label="Advertiser and payer">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-sm">Advertiser & Payer</h3><Badge tone="warning">Meta verification required</Badge></div>
  {name?<>
   <dl className="grid gap-3 sm:grid-cols-2">{['Advertiser','Payer'].map(role=><div key={role} className="rounded-lg border border-border p-3"><dt className="text-xs text-text-secondary">{role}</dt><dd className="mt-1 text-sm font-medium break-words">{name}</dd></div>)}</dl>
   <p className="text-xs text-text-secondary">Supreme account default. Brands identify internal campaign attribution only. Use this default only when The Y is legally responsible as both advertiser and payer.</p>
  </>:<p className="text-xs text-text-secondary">Use the selected Ad Account’s actual advertiser and payer. An internal Brand is not a legal declaration.</p>}
  <p className="text-xs text-text-secondary">A default name does not establish verification. Save Draft is available while Meta verification is pending. Manage verification in Meta using the link above.</p>
  <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)} className="rounded-lg border border-border p-3">
   <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Meta identity references{form.universal_beneficiary||form.universal_payer?' · saved values retained':''}</summary>
   <p className="mt-3 text-xs text-text-secondary">Only use verified references issued by Meta for the actual advertiser and payer. Names, Page IDs and manually entered numbers are not verification proof. Existing saved references are preserved; confirm they belong to the selected account and responsible entity.</p>
   <div className="mt-3 grid gap-3 sm:grid-cols-2">{[['universal_beneficiary','Advertiser (beneficiary) identity ID'],['universal_payer','Payer identity ID']].map(([key,label])=><AdminFormField key={key} label={label}><input className="control" inputMode="numeric" maxLength={30} value={form[key]} onChange={e=>onChange(key,e.target.value)} disabled={disabled}/></AdminFormField>)}</div>
  </details>
 </section>;
}
