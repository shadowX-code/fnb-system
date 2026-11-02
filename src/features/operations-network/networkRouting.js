// Routes use the same graph coordinates as React Flow. Headings are not obstacles.
const clearance = 6;
const isBody = node => !['operation-group','agent-group','data-group'].includes(node.data.kind);
export const segmentBlocked = (a, b, boxes) => boxes.some(r => a.x === b.x
  ? a.x > r.left && a.x < r.right && Math.max(a.y,b.y) > r.top && Math.min(a.y,b.y) < r.bottom
  : a.y > r.top && a.y < r.bottom && Math.max(a.x,b.x) > r.left && Math.min(a.x,b.x) < r.right);
const anchor = (node, side, gap = 0) => ({x: node.position.x + (side === 'left' ? -gap : side === 'right' ? node.width + gap : node.width/2), y: node.position.y + (side === 'top' ? -gap : side === 'bottom' ? node.height + gap : node.height/2)});
const simplify = points => points.filter((p,i) => (!i || p.x !== points[i-1].x || p.y !== points[i-1].y) && (!i || i === points.length-1 || !((p.x === points[i-1].x && p.x === points[i+1].x) || (p.y === points[i-1].y && p.y === points[i+1].y))));

class MinHeap {
  items = [];
  push(value) { const a=this.items; a.push(value); let i=a.length-1; while(i){const p=(i-1)>>1;if(a[p].score<=value.score)break;a[i]=a[p];i=p;}a[i]=value; }
  pop() { const a=this.items, first=a[0], last=a.pop(); if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].score<a[c].score)c++;if(last.score<=a[c].score)break;a[i]=a[c];i=c;}a[i]=last;}return first; }
}
let cachedKey = '', cachedRoutes;
export function routeNetworkEdges(nodes, edges) {
  const key=JSON.stringify([nodes.map(n=>[n.id,n.position.x,n.position.y,n.width,n.height]),edges.map(e=>[e.id,e.source,e.target])]);
  if(key===cachedKey) return edges.map(e=>({...e,...cachedRoutes.get(e.id),data:{...e.data,...cachedRoutes.get(e.id).data}}));
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const boxes=nodes.filter(isBody).map(n=>({left:n.position.x-clearance,right:n.position.x+n.width+clearance,top:n.position.y-clearance,bottom:n.position.y+n.height+clearance}));
  const plans=edges.map(edge=>{
    const s=byId.get(edge.source),t=byId.get(edge.target);
    const down=t.position.y>s.position.y, same=t.position.y===s.position.y;
    const right=t.position.x>s.position.x;
    const sourceSide=same?(right?'right':'left'):(down?'bottom':'top');
    const targetSide=same?(right?'left':'right'):(down?'top':'bottom');
    return {edge,s,t,sourceSide,targetSide,start:anchor(s,sourceSide,clearance),end:anchor(t,targetSide,clearance)};
  });
  const xs=[...new Set([...boxes.flatMap(r=>[r.left,r.right]),...plans.flatMap(p=>[p.start.x,p.end.x]),Math.min(...boxes.map(r=>r.left))-20,Math.max(...boxes.map(r=>r.right))+20])].sort((a,b)=>a-b);
  const ys=[...new Set([...boxes.flatMap(r=>[r.top,r.bottom]),...plans.flatMap(p=>[p.start.y,p.end.y]),Math.min(...boxes.map(r=>r.top))-20,Math.max(...boxes.map(r=>r.bottom))+20])].sort((a,b)=>a-b);
  const width=xs.length, points=ys.flatMap(y=>xs.map(x=>({x,y}))), links=points.map(()=>[]);
  for(let y=0;y<ys.length;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    for(const j of [x+1<width?i+1:-1,y+1<ys.length?i+width:-1]) if(j>=0&&!segmentBlocked(points[i],points[j],boxes)) {
      const length=Math.abs(points[i].x-points[j].x)+Math.abs(points[i].y-points[j].y),axis=points[i].x===points[j].x?1:2;
      links[i].push({index:j,length,axis});links[j].push({index:i,length,axis});
    }
  }
  // Congestion costs prefer separate available channels without changing relationship direction.
  const used=new Map(), routes=new Map();
  for(const plan of [...plans].sort((a,b)=>a.edge.id.localeCompare(b.edge.id))){
    const {edge,s,t,sourceSide,targetSide,start,end}=plan;
    const startIndex=ys.indexOf(start.y)*width+xs.indexOf(start.x), endIndex=ys.indexOf(end.y)*width+xs.indexOf(end.x);
    const heap=new MinHeap(),costs=new Map(),previous=new Map();
    const heuristic=i=>Math.abs(points[i].x-end.x)+Math.abs(points[i].y-end.y);
    heap.push({index:startIndex,axis:0,cost:0,score:heuristic(startIndex)});costs.set(startIndex*3,0);
    let finish;
    while(heap.items.length){
      const current=heap.pop(),state=current.index*3+current.axis;
      if(current.cost!==costs.get(state))continue;
      if(current.index===endIndex){finish=state;break;}
      for(const next of links[current.index]){
        const lane=[Math.min(current.index,next.index),Math.max(current.index,next.index)].join(':');
        const cost=current.cost+next.length+(current.axis&&current.axis!==next.axis?18:0)+(used.get(lane)||0)*Math.min(next.length*.15,12);
        const nextState=next.index*3+next.axis;
        if(cost>=(costs.get(nextState)??Infinity))continue;
        costs.set(nextState,cost);previous.set(nextState,state);heap.push({index:next.index,axis:next.axis,cost,score:cost+heuristic(next.index)});
      }
    }
    if(finish===undefined) throw new Error(`No unobstructed network route: ${edge.id}`);
    const indexes=[];for(let state=finish;state!==undefined;state=previous.get(state))indexes.push(Math.floor(state/3));indexes.reverse();
    for(let i=1;i<indexes.length;i++){const lane=[Math.min(indexes[i-1],indexes[i]),Math.max(indexes[i-1],indexes[i])].join(':');used.set(lane,(used.get(lane)||0)+1);}
    const routePoints=simplify([anchor(s,sourceSide),...indexes.map(i=>points[i]),anchor(t,targetSide)]);
    const routeLength=routePoints.slice(1).reduce((total,p,i)=>total+Math.hypot(p.x-routePoints[i].x,p.y-routePoints[i].y),0);
    routes.set(edge.id,{sourceHandle:`out-${sourceSide}`,targetHandle:`in-${targetSide}`,data:{routePoints,routeLength,sourceLayer:s.data.layer,targetLayer:t.data.layer,longStructural:edge.data.kind!=='execution'&&(Math.abs(s.data.layer-t.data.layer)>1||routeLength>400)}});
  }
  cachedKey=key;cachedRoutes=routes;
  return edges.map(e=>({...e,...routes.get(e.id),data:{...e.data,...routes.get(e.id).data}}));
}

export function roundedRoute(points) {
  let path=`M ${points[0].x} ${points[0].y}`;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],p=points[i],b=points[i+1],before=Math.hypot(p.x-a.x,p.y-a.y),after=Math.hypot(b.x-p.x,b.y-p.y);
    const r=Math.min(10,before/2,after/2);
    const entry={x:p.x+(a.x-p.x)*r/before,y:p.y+(a.y-p.y)*r/before},exit={x:p.x+(b.x-p.x)*r/after,y:p.y+(b.y-p.y)*r/after};
    path+=` L ${entry.x} ${entry.y} Q ${p.x} ${p.y} ${exit.x} ${exit.y}`;
  }
  const last=points.at(-1);return `${path} L ${last.x} ${last.y}`;
}
