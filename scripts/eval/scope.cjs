'use strict';
const ignored = p => ['/notes','/version','/updatedAt'].some(x=>p===x||p.startsWith(x+'/'));
const keyed = x => Array.isArray(x)&&x.every(v=>v!==null&&typeof v==='object'&&typeof v.id==='string')&&new Set(x.map(v=>v.id)).size===x.length;
function aligned(a,b) {
  if(!keyed(a)||!keyed(b))return [a,b];
  const ids=[...new Set([...a.map(v=>v.id),...b.map(v=>v.id)])];
  return [ids.map(id=>a.find(v=>v.id===id)),ids.map(id=>b.find(v=>v.id===id))];
}
function leaves(a,b,p='',out=[]) {
  if(JSON.stringify(a)===JSON.stringify(b))return out;
  [a,b]=aligned(a,b);
  const objectA=a!==null&&typeof a==='object',objectB=b!==null&&typeof b==='object';
  if((objectA||a===undefined)&&(objectB||b===undefined)) {
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    if(keys.size) {for(const k of keys)leaves(a?.[k],b?.[k],p+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),out);return out;}
  }
  out.push({path:p,before:a===undefined?{absent:true}:a,after:b===undefined?{absent:true}:b});
  return out;
}
function substantive(a,b) {return leaves(a,b).filter(x=>!ignored(x.path));}
// The engine's word-anchored collections (reelengine/project.py _anchor_slots), outside cut.keep.
const ANCHORED = [
  {at:['broll'],slots:[['anchor','from'],['anchor','to']]},
  {at:['zooms'],slots:[['anchor','from'],['anchor','to']]},
  {at:['music','automation'],slots:[['fromWord'],['toWord']]},
  {at:['captions','hidden'],slots:[['from'],['to']]},
];
function kept(project,words) {
  const index=new Map(words.map((w,i)=>[w.id,i])),out=new Set();
  for(const r of project.cut?.keep||[]) {
    const i=index.get(r.from),j=index.get(r.to);
    if(i===undefined||j===undefined)throw Error(`cut.keep references a word missing from the transcript: ${r.from}..${r.to}`);
    for(let k=i;k<=j;k++)out.add(words[k].id);
  }
  return out;
}
const get = (x,keys) => keys.reduce((v,k)=>v?.[k],x);
// A change outside allowPaths is the note's consequence when it touches an item anchored on a word
// the note's own cut removed, and the item is removed or only re-anchored onto words still kept.
function check(before,after,words,allowPaths) {
  const stillKept=kept(after,words),lost=new Set([...kept(before,words)].filter(id=>!stillKept.has(id)));
  const diff=substantive(before,after),unexpected=[],consequences=[];
  for(const x of diff) {
    if(allowPaths.some(p=>x.path===p||x.path.startsWith(p+'/')))continue;
    (consequence(x.path)?consequences:unexpected).push(x);
  }
  return {diff,unexpected,consequences};
  function consequence(pointer) {
    const parts=pointer.split('/').slice(1);
    for(const c of ANCHORED) {
      if(c.at.some((k,i)=>parts[i]!==k)||parts.length<=c.at.length)continue;
      const [was,now]=aligned(get(before,c.at),get(after,c.at)).map(list=>list?.[Number(parts[c.at.length])]);
      if(!was||!c.slots.some(s=>lost.has(get(was,s))))return false;
      if(now===undefined)return true;
      const leaf=parts.slice(c.at.length+1);
      return c.slots.every(s=>stillKept.has(get(now,s)))&&c.slots.some(s=>s.every((k,i)=>leaf[i]===k)&&leaf.length===s.length);
    }
    return false;
  }
}
module.exports={ignored,substantive,check};
