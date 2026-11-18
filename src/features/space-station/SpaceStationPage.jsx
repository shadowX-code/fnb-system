import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, ChevronRight, Clapperboard, Compass, Factory, Focus, List, Minus, Orbit, Pause, Play, Plus, RotateCcw, RotateCw, Telescope } from "lucide-react";
import { rooms, roomById, objectsIn } from "./departments.js";
import "./station.css";

const icons={command:Compass,finance:ChartNoAxesCombined,factory:Factory,marketing:Clapperboard};
function Tool({title,children,onClick,pressed}) {
  return <button type="button" aria-label={title} title={title} onClick={onClick} aria-pressed={pressed}>{children}</button>;
}

export default function SpaceStationPage({ui}) {
  const host=useRef(null), runtime=useRef(null);
  const [mode,setMode]=useState("scene"), [status,setStatus]=useState("Loading 3D engine…"), [quality,setQuality]=useState(false);
  const [roomId,setRoom]=useState(null), [selection,select]=useState(null);
  const [paused,pause]=useState(()=>window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const current=useRef({roomId,selection,paused}); current.current={roomId,selection,paused};
  const backButton=useRef(null), directoryButtons=useRef({});
  const room=roomById[roomId], objects=room ? objectsIn(room) : [], object=objects.find(item=>item.id===selection);
  const allowed=id=>id && ui.networkRoutes.some(route=>route.id===id);
  function openModule(id) { if(allowed(id)) ui.navigate(id); }
  function enter(id) {select(null); setRoom(id); requestAnimationFrame(()=>backButton.current?.focus({preventScroll:true}));}
  function leave() {const old=roomId; setRoom(null); select(null); requestAnimationFrame(()=>directoryButtons.current[old]?.focus({preventScroll:true}));}

  useEffect(()=>{
    if(mode!=="scene") return;
    let cancelled=false, engine;
    const page=host.current;
    setStatus("Loading 3D engine…"); setQuality(false);
    import("./stationRuntime.js").then(({createStation})=>{
      if(cancelled) return;
      setStatus("Assembling station…");
      engine=createStation(page,{
        enter,select,
        ready:()=>setStatus(""),
        quality:()=>setQuality(true),
        error:message=>{setStatus(message);setMode("error");},
      });
      runtime.current=engine;
      engine.focus(current.current.roomId); engine.select(current.current.selection); engine.pause(current.current.paused);
    }).catch(()=>{if(!cancelled) {setStatus("This device could not open the 3D view.");setMode("error");}});
    return ()=>{cancelled=true;engine?.dispose();runtime.current=null;};
  },[mode]);
  useEffect(()=>{runtime.current?.focus(roomId);},[roomId]);
  useEffect(()=>{runtime.current?.select(selection);},[selection]);
  useEffect(()=>{runtime.current?.pause(paused);},[paused]);
  const directory=mode!=="scene";
  return <section className="station-page" aria-label="Space Station">
    <header className="station-heading">
      <div className="station-insignia"><Orbit size={25} strokeWidth={1.6}/></div>
      <div><h1>Space Station</h1><p>Virtual operations workspace</p></div>
      <button type="button" className="station-mode" onClick={()=>{setRoom(null);select(null);setMode(directory ? "scene" : "directory");}}>{directory ? <Orbit size={16}/> : <List size={16}/>} {directory ? "Launch 3D view" : "Directory"}</button>
    </header>
    {directory ? <div className="station-directory">
      <p className="station-eyebrow">Station directory</p><h2>Departments</h2>
      <p role="status">{mode==="error" ? status+" " : ""}Open an available FeedX module.</p>
      <div>{rooms.filter(r=>r.route).map(r=>{const Icon=icons[r.id];return <article key={r.id}>
        <Icon size={21}/><div><h3>{r.name}</h3><p>{r.subject}</p></div>
        {allowed(r.route) ? <button type="button" onClick={()=>openModule(r.route)}>{r.link} <ArrowUpRight size={14}/></button> : <span>Module access required</span>}
      </article>;})}</div>
    </div> : <>
      <div className="station-viewport" onKeyDown={e=>{if(e.key==="Escape" && roomId) leave();}}>
        <div ref={host} className="station-canvas-host"/>
        <div className="station-view-info">
          {room ? <button ref={backButton} className="station-back" type="button" onClick={leave}><ArrowLeft size={15}/> Back to Station</button> : <span className="station-eyebrow"><i/> Orbital view</span>}
          <h2>{room?.name ?? "Station overview"}</h2>
        </div>
        {!status && <div className="station-tools">
          <Tool title="Zoom in" onClick={()=>runtime.current?.zoom(1.15)}><Plus/></Tool>
          <Tool title="Zoom out" onClick={()=>runtime.current?.zoom(1/1.15)}><Minus/></Tool>
          <Tool title="Orbit left" onClick={()=>runtime.current?.orbit(-.13)}><RotateCcw/></Tool>
          <Tool title="Orbit right" onClick={()=>runtime.current?.orbit(.13)}><RotateCw/></Tool>
          <Tool title="Reset camera" onClick={()=>runtime.current?.reset()}><Focus/></Tool>
          <Tool title={paused ? "Resume simulation" : "Pause simulation"} pressed={paused} onClick={()=>pause(!paused)}>{paused ? <Play/> : <Pause/>}</Tool>
        </div>}
        {status && <div className="station-loading" role="status"><Orbit size={24}/>{status}</div>}
        <span className="station-simulation"><i/>{paused ? "Simulation paused" : "Local simulation"}{quality ? " · Reduced detail" : ""}</span>
      </div>
      {!room ? <nav className="station-decks" aria-label="Station cabins">
        {rooms.map(r=>{const Icon=icons[r.id];return <button key={r.id} ref={el=>{directoryButtons.current[r.id]=el;}} type="button" onClick={()=>enter(r.id)}>
          <span style={{color:r.accent}}><Icon size={20}/></span><b>{r.name}</b><ChevronRight size={15}/>
        </button>;})}
      </nav> : <div className="station-inspector">
        <label><span>Inspect cabin</span><select value={selection ?? ""} onChange={e=>select(e.target.value || null)}>
          <option value="">Choose a person or device</option>{objects.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="station-inspection" aria-live="polite">{object ? <><strong>{object.label}{object.character && <small>Simulated crew</small>}</strong><p>{object.detail}</p></> : <p>Select a crew member, screen or piece of equipment to inspect it.</p>}</div>
        {object?.module && (allowed(room.route) ? <button type="button" onClick={()=>openModule(room.route)}>{room.link}<ArrowUpRight size={15}/></button> : <small>Module access required</small>)}
      </div>}
      <footer className="station-footer"><Telescope size={15}/><span>Drag to orbit · Scroll to zoom</span><span>Characters and displays are simulated.</span></footer>
    </>}
  </section>;
}
