/** Compact section navigation shared by source editors; draft state stays with the editor. */
export default function AdminEditorSections({label, sections, value, onChange, disabled=false, errorSection}) {
  return <nav className="outlet-editor-nav" aria-label={label}>{sections.map(({key,label,icon:Icon})=><button type="button" key={key} disabled={disabled} aria-label={label} aria-current={value===key?'page':undefined} onClick={()=>onChange(key)} className={value===key?'is-active':''}>{Icon?<Icon size={16}/>:null}<span>{label}</span>{errorSection===key?<span aria-label="Needs attention">!</span>:null}</button>)}</nav>;
}
