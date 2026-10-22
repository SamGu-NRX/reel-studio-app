#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here,'../..');
const GiB = 1024 ** 3;
const flags = {};
for (let i=2;i<process.argv.length;i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) throw Error(`unexpected argument ${arg}`);
  const split = arg.indexOf('=');
  const key = split<0 ? arg.slice(2) : arg.slice(2,split);
  flags[key] = split<0 ? process.argv[++i] : arg.slice(split+1);
  if (!flags[key]) throw Error(`missing value for --${key}`);
}
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const write = (p,x) => { fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n'); };
const run = (command,args,options={}) => execFileSync(command,args,{encoding:'utf8',maxBuffer:16*1024**2,stdio:['ignore','pipe','pipe'],...options}).trim();
const slug = x => { if (!/^[a-zA-Z0-9_-]+$/.test(x)) throw Error(`unsafe id ${x}`); return x; };
const py = flags.python || 'python3', ffmpeg = flags.ffmpeg || 'ffmpeg', ffprobe = flags.ffprobe || 'ffprobe';
let scratch, build;
const adapters=new Set();
function size(dir) {
  let n=0;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name),s=fs.lstatSync(p);
    if(ent.isDirectory()) n+=size(p);
    else if(ent.isFile() && s.nlink===1) n+=s.blocks*512;
  }
  return n;
}
function memoryReady() {
  if(process.platform==='darwin') {
    return Number(run('sysctl',['-n','kern.memorystatus_vm_pressure_level']))<4;
  }
  return os.freemem()>=3*GiB;
}
function guard() {
  const disk=fs.statfsSync(scratch);
  if(disk.bavail*disk.bsize<3*GiB) throw Error('resource guard: less than 3 GiB free disk');
  if(!memoryReady()) throw Error('resource guard: memory pressure is too high');
  if(size(scratch)>=2*GiB) throw Error('resource guard: scratch reached 2 GiB');
}
function cleanupMedia(dir) {
  if(!fs.existsSync(dir))return;
  for(const sub of ['work/render','work/audio'])fs.rmSync(path.join(dir,sub),{recursive:true,force:true});
  function outputs(root) {
    if(!fs.existsSync(root))return;
    for(const ent of fs.readdirSync(root,{withFileTypes:true})) {
      const file=path.join(root,ent.name);
      if(ent.isDirectory())outputs(file);
      else if(ent.isFile()&&/\.(mp4|wav|png|jpe?g|ass)$/.test(ent.name))fs.unlinkSync(file);
    }
  }
  outputs(path.join(dir,'versions'));
  const notes=path.join(dir,'work/notes');
  if(fs.existsSync(notes))for(const note of fs.readdirSync(notes,{withFileTypes:true}))if(note.isDirectory()) {
    for(const name of ['draft.mp4','export.mp4','cover.png','captions.ass'])fs.rmSync(path.join(notes,note.name,name),{force:true});
  }
}
function copyJSON(src,dst) {
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})) {
    const a=path.join(src,e.name),b=path.join(dst,e.name);
    if(e.isDirectory())copyJSON(a,b);
    else if(e.isFile()) {
      if(e.name.endsWith('.json')||e.name.endsWith('.md'))fs.copyFileSync(a,b);
      else fs.linkSync(a,b);
    }
  }
}
const {ignored,substantive,check:scopeCheck}=require('./scope.cjs');
function manifest(file) {
  const m=read(file),base=path.dirname(file),ids=new Set();
  if(m.schemaVersion!==1||!Array.isArray(m.clips)||!m.clips.length)throw Error('manifest requires schemaVersion 1 and clips');
  for(const c of m.clips) {
    slug(c.id); if(ids.has(c.id))throw Error('duplicate clip id');ids.add(c.id);
    if(!c.path||!c.description||!Array.isArray(c.notes)||(c.expectedOutcome==='no_audio'?c.notes.length!==0:c.notes.length!==3))throw Error(`${c.id}: exactly 3 notes required`);
    if(!c.path.startsWith('generated://'))c.path=path.resolve(base,c.path);
    if(c.transcript)c.transcript=path.resolve(base,c.transcript);
    const notes=new Set();for(const n of c.notes) {
      slug(n.id);if(notes.has(n.id))throw Error('duplicate note id');notes.add(n.id);
      if(typeof n.text!=='string'||!n.text||!Array.isArray(n.allowPaths)||!n.allowPaths.length)throw Error(`${c.id}/${n.id}: text and allowPaths required`);
      if(n.allowPaths.some(p=>typeof p!=='string'||!p.startsWith('/')||ignored(p)))throw Error('allowPaths must be substantive JSON pointers');
    }
  }
  return m;
}
function generated(dir) {
  guard();fs.mkdirSync(dir,{recursive:true});
  const text='Hello this is a generated clip hello this is a repeated take';
  const words=[],files=[];let clock=0;
  for(const [i,w] of text.split(' ').entries()) {
    guard();const speech=path.join(dir,`speech-${i}.wav`),wav=path.join(dir,`part-${i}.wav`);
    if(process.platform==='darwin')run('say',['-o',speech,'--file-format=WAVE','--data-format=LEI16@22050',w]);
    else run('espeak',['-w',speech,w]);
    const dur=Number(run(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',speech]));
    const slot=dur+0.2;
    run(ffmpeg,['-y','-v','error','-i',speech,'-af',`apad=pad_dur=0.2,atrim=duration=${slot}`,'-ar','48000','-ac','1',wav]);
    words.push({id:`w${i}`,source:'s1',s:clock,e:clock+dur,w,p:1});clock+=slot;files.push(wav);fs.unlinkSync(speech);
  }
  const list=path.join(dir,'concat.txt');fs.writeFileSync(list,files.map(p=>`file '${path.basename(p)}'`).join('\n'));
  const mp4=path.join(dir,'synthetic.mp4');
  run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=30','-f','concat','-safe','1','-i',list,'-t',String(clock),'-c:v','libx264','-crf','28','-pix_fmt','yuv420p','-c:a','aac',mp4]);
  for(const p of files)fs.unlinkSync(p);fs.unlinkSync(list);
  const transcript=path.join(dir,'transcript.json');write(transcript,{model:'generated-word-slots',language:'en',nextId:words.length,words,segments:[]});
  return {media:mp4,transcript};
}
async function main() {
  const manifestFile=path.resolve(flags.manifest||path.join(here,'manifest.example.json'));
  const corpus=manifest(manifestFile);
  const out=path.resolve(flags.out||'/tmp/rs-eval/runs');fs.mkdirSync(out,{recursive:true});
  const runDir=fs.mkdtempSync(path.join(out,new Date().toISOString().replace(/[:.]/g,'-')+'-'));
  scratch=fs.mkdtempSync(path.join(os.tmpdir(),'reel-eval-'));
  let selected=path.resolve(flags.build||repo), source=selected;
  const depsDir=fs.existsSync(path.join(selected,'node_modules/typescript/bin/tsc'))?path.join(selected,'node_modules'):path.join(repo,'node_modules');
  const report={schemaVersion:1,startedAt:new Date().toISOString(),provider:flags.provider||'mock',model:flags.model||null,build:{sha:null,dirty:null},clips:[],status:'FAIL',syntheticOnly:corpus.clips.every(c=>c.path.startsWith('generated://')),liveNoRegression:'UNAVAILABLE'};
  const abort=new AbortController();
  process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  try {
    guard();
    if(flags.branch) {
      const sha=run('git',['rev-parse','--verify',`${flags.branch}^{commit}`],{cwd:selected});
      source=path.join(scratch,'source');fs.mkdirSync(source);const archive=path.join(scratch,'source.tar');
      run('git',['archive','-o',archive,sha],{cwd:selected});run('tar',['-xf',archive,'-C',source]);fs.unlinkSync(archive);
      report.build={sha,dirty:false,ref:flags.branch};
      fs.symlinkSync(depsDir,path.join(source,'node_modules'),'dir');
    } else report.build={sha:run('git',['rev-parse','HEAD'],{cwd:source}),dirty:!!run('git',['status','--porcelain'],{cwd:source})};
    build=path.join(scratch,'compiled');guard();
    run(process.execPath,[path.join(depsDir,'typescript/bin/tsc'),'-p',path.join(source,'ai/tsconfig.json'),'--outDir',build,'--declaration','false','--baseUrl',depsDir,'--typeRoots',path.join(depsDir,'@types')]);
    fs.symlinkSync(depsDir,path.join(scratch,'node_modules'),'dir');
    const agent=require(path.join(build,'agent.js')),tools=require(path.join(build,'tools.js'));
    const metrics=require('./metrics.cjs').instrument(agent,tools);
    const AI=require(path.join(build,'index.js')),editor=require(path.join(build,'editor.js'));
    const {ScriptedProvider}=require('./mock.cjs');
    const strippedSecrets=Object.fromEntries(Object.keys(process.env).filter(k=>/KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION/i.test(k)).map(k=>[k,undefined]));
    const rawHost=new AI.PythonEngineHost({python:py,cwd:path.join(source,'engine'),root:path.join(scratch,'root'),env:{...strippedSecrets,PYTHONPATH:path.join(source,'engine'),REELENGINE_FFMPEG:ffmpeg,REELENGINE_FFPROBE:ffprobe,REELENGINE_CACHE:path.join(scratch,'cache'),REELENGINE_CACHE_DIR:path.join(scratch,'cache'),REELENGINE_MODELS:flags.models?path.resolve(flags.models):path.join(scratch,'models'),REELENGINE_FONTS:path.join(source,'packaging/fonts')}});
    const host={reelStudioRoot:()=>rawHost.reelStudioRoot(),renderAnimation:(...args)=>(adapterAnimation??rawHost.renderAnimation.bind(rawHost))(...args),runEngine:async(...args)=>{guard();return rawHost.runEngine(...args)}};
    report.runtimeSettings={firstLook:(flags.provider||'mock')!=='mock',fastNotes:(flags.provider||'mock')!=='mock',finalRender:true};
    const deps={host,prompts:new AI.Prompts(path.join(source,'ai/prompts')),style:new AI.StyleStore(()=>host.reelStudioRoot()),...((flags.provider||'mock')==='mock'?{firstLook:false,fastNotes:false}:{}),finalRender:true};
    const profileDir=path.join(scratch,'profile');fs.mkdirSync(profileDir,{recursive:true});
    let laneBlocked=false,adapterAnimation=null;
    for(const clip of corpus.clips) {
      const dir=path.join(runDir,clip.id);fs.mkdirSync(dir);const cr={id:clip.id,status:'FAIL',tasks:[],determinism:{status:'UNAVAILABLE'}};report.clips.push(cr);
      if(laneBlocked){cr.status='BLOCKED';cr.reason='provider lane stopped after previous provider error';continue;}
      let project=path.join(scratch,clip.id),creatingAdapter=false;
      try {
        let media=clip.path,transcript=clip.transcript;
        if(media.startsWith('generated://'))({media,transcript}=generated(path.join(scratch,'generated-'+clip.id)));
        if(!fs.existsSync(media))throw Error('media unavailable');
        const probe=JSON.parse(run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',media]));write(path.join(dir,'probe.json'),probe);
        const original=fs.statSync(media);await host.runEngine('init',['--project',project,'--title',clip.description,media],undefined,abort.signal);
        const projectData=read(path.join(project,'project.json'));const linked=fs.statSync(path.join(project,projectData.sources[0].path));
        cr.mediaHardlinked=original.dev===linked.dev&&original.ino===linked.ino;
        if(transcript) {
          const t=read(transcript);if(!Array.isArray(t.words)||!t.words.length)throw Error('explicit transcript has no words');
          for(const w of t.words)if(typeof w.id!=='string'||typeof w.w!=='string'||!Number.isFinite(w.s)||!Number.isFinite(w.e)||w.s>=w.e||w.e>projectData.sources[0].duration+0.05)throw Error('invalid explicit transcript word');
          write(path.join(project,'work/transcript.json'),t);projectData.transcript={file:'work/transcript.json',language:t.language||'en'};write(path.join(project,'project.json'),projectData);
        }else await host.runEngine('transcribe',['--project',project],undefined,abort.signal);
        await host.runEngine('analyze',['--project',project],undefined,abort.signal);
        await host.runEngine('autocut',['--project',project],undefined,abort.signal);
        let raw;
        if((flags.provider||'mock')==='mock')raw=new ScriptedProvider();
        else if(flags.provider==='claude-cli'&&!flags['provider-adapter']) {
          creatingAdapter=true;
          const appAI=AI.createAI({host,settingsDir:profileDir,dev:true,promptsDir:path.join(source,'ai/prompts')});
          await appAI.setModel('cli',flags.model||'opus');await appAI.setActive('claude-cli');
          raw=new AI.ClaudeCliProvider({model:flags.model||'opus',session:true});creatingAdapter=false;
        } else {
          if(!flags['provider-adapter']||!path.isAbsolute(flags['provider-adapter']))throw Error('live provider requires absolute --provider-adapter');
          creatingAdapter=true;
          const imported=await import(pathToFileURL(flags['provider-adapter']).href);const adapter=imported.default;
          if(typeof adapter!=='function')throw Error('provider adapter must export a function');
          raw=await adapter({AI,host,profileDir,provider:flags.provider,model:flags.model||null,build:source,signal:abort.signal});
          if(typeof raw?.complete!=='function')throw Error('provider adapter did not return a ModelProvider');adapters.add(raw);adapterAnimation=raw.renderAnimation?.bind(raw)??null;creatingAdapter=false;
        }
        cr.provider={id:raw.id,model:raw.model||null};
        const provider=metrics.wrap(raw);
        async function task(id,note,recordDir) {
          const started=performance.now(),m=metrics.start(id),before=read(path.join(project,'project.json')),events=[];
          const r={id,status:'FAIL',editorCompleted:false,reliabilityStatus:'FAIL',qualityStatus:'UNAVAILABLE',quality:'UNAVAILABLE',metrics:m};
          process.stderr.write(`${clip.id}/${id}: started\n`);
          try {
            if(raw.select) {
              let calls=note?.mockTools;
              if(!note) {const t=read(path.join(project,'work/transcript.json'));calls=[{name:'set_cut',args:{keep:[{from:t.words[0].id,to:t.words.at(-1).id}]}},{name:'set_caption_style',args:{enabled:true,size:105,position:0.75}},{name:'set_cover',args:{atSourceTime:t.words[0].s,source:'s1',text:null}},{name:'write_post',args:{caption:'Eval corpus example.',hashtags:['synthetic','editing','speech','captions','example'],keywords:['generated speech']}}];}
              if(!Array.isArray(calls))throw Error('mock lane requires explicit mockTools for every note');raw.select({id,calls});
            }
            const fn=e=>events.push(e.type==='status'?{type:e.type,message:e.message}:e);
            const result=note?await editor.applyNote(deps,provider,project,note.text,fn,abort.signal,{id:slug(note.id)}):await editor.firstEdit(deps,provider,project,fn,abort.signal);
            r.editorCompleted=true;
            if(m.providerErrors.length&&m.agentRuns.some(r=>r.error))laneBlocked=true;
            const after=read(path.join(project,'project.json'));
            if(note) {const s=scopeCheck(before,after,read(path.join(project,after.transcript.file)).words,note.allowPaths);r.diff=s.diff;r.scope={allowed:note.allowPaths,unexpected:s.unexpected,consequences:s.consequences};r.changed=r.diff.length>0;}
            else r.diff=substantive(before,after);
            guard();const q=JSON.parse(run(py,[path.join(here,'quality.py'),project],{env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION/i.test(k))),PYTHONPATH:path.join(source,'engine')}}));
            write(path.join(recordDir,'quality.json'),q);write(path.join(recordDir,'project-before.json'),before);write(path.join(recordDir,'project-after.json'),after);
            r.quality=q.status;r.qualityStatus=q.status;r.notice=result.notice||null;r.fast=result.fast||null;r.reliabilityStatus=!r.notice&&m.stoppedByCaps===0&&m.validationErrors.length===0&&m.executionErrors.length===0&&(m.agentRuns.length>0||Boolean(result.fast))&&m.agentRuns.every(run=>!run.error)&&(!note||(r.changed&&!r.scope.unexpected.length))?'PASS':'FAIL';r.status=r.reliabilityStatus==='PASS'&&r.qualityStatus==='PASS'?'PASS':'FAIL';
          }catch(e){r.error={code:e.code||null,message:String(e.userMessage||e.message||e)};r.editorCompleted=true;
            if(m.providerErrors.length&&m.agentRuns.some(r=>r.error))laneBlocked=true;}
          finally{r.wallMs=performance.now()-started;process.stderr.write(`${clip.id}/${id}: reliability ${r.reliabilityStatus}, quality ${r.qualityStatus}\n`);write(path.join(recordDir,'evidence.json'),{...r,events});cleanupMedia(project);}
          return r;
        }
        cr.tasks.push(await task('firstEdit',null,path.join(dir,'firstEdit')));
        const baseline=path.join(scratch,clip.id+'-baseline');copyJSON(project,baseline);
        for(const note of clip.notes) {if(laneBlocked)break;cr.tasks.push(await task(note.id,note,path.join(dir,note.id)));}
        if(!laneBlocked && cr.tasks[0].editorCompleted && !cr.tasks[0].notice) {
          const hashes=[];const repeats=[];const originalProject=project;
          for(let i=0;i<3;i++) {
            project=path.join(scratch,clip.id+'-repeat-'+i);copyJSON(baseline,project);
            const r=await task('repeat-'+i,clip.notes[0],path.join(dir,'repeat-'+i));repeats.push(r);
            if(r.reliabilityStatus==='PASS')hashes.push(JSON.stringify(r.diff));fs.rmSync(project,{recursive:true,force:true});
            if(laneBlocked)break;
          }
          project=originalProject;cr.determinism={status:repeats.length===3&&repeats.every(r=>r.reliabilityStatus==='PASS')&&new Set(hashes).size===1?'PASS':'FAIL',runs:repeats};
        }
        cr.status=laneBlocked?'BLOCKED':cr.tasks.length===4&&cr.tasks.every(r=>r.status==='PASS')&&cr.determinism.status==='PASS'?'PASS':'FAIL';
      }catch(e){cr.reason=String(e.userMessage||e.message||e);cr.status='UNAVAILABLE';if(clip.expectedOutcome==='no_audio'&&e.code==='NO_AUDIO'){const probe=read(path.join(dir,'probe.json'));if(!probe.streams.some(s=>s.codec_type==='audio')){cr.status='EXPECTED_REJECTION';cr.engineCode='NO_AUDIO';cr.quality='UNAVAILABLE';}}if(creatingAdapter){cr.status='BLOCKED';laneBlocked=true;}}
      finally{cleanupMedia(project);write(path.join(dir,'clip.json'),cr);for(const own of [project,path.join(scratch,clip.id+'-baseline'),path.join(scratch,'generated-'+clip.id)])fs.rmSync(own,{recursive:true,force:true});}
    }
    report.status=report.clips.length&&report.clips.every(c=>c.status==='PASS'||c.status==='EXPECTED_REJECTION')?'PASS':report.clips.some(c=>c.status==='BLOCKED')?'BLOCKED':'FAIL';
  }catch(e){report.error=String(e.message||e);}
  finally {
    for(const adapter of adapters) {try{await adapter.close?.();}catch(e){report.adapterCloseError=String(e.message||e);report.status='FAIL';}}
    report.finishedAt=new Date().toISOString();
    report.summary={clips:report.clips.length,expectedRejections:report.clips.filter(c=>c.status==='EXPECTED_REJECTION').length,blockedClips:report.clips.filter(c=>c.status==='BLOCKED').length,reliability:{},quality:{},determinism:{}};
    const allTasks=report.clips.flatMap(c=>[...(c.tasks||[]),...(c.determinism?.runs||[])]);
    for(const status of ['PASS','FAIL','UNAVAILABLE']){report.summary.reliability[status]=allTasks.filter(t=>t.reliabilityStatus===status).length;report.summary.quality[status]=allTasks.filter(t=>t.qualityStatus===status).length;report.summary.determinism[status]=report.clips.filter(c=>c.determinism?.status===status).length;}
    for(const name of ['parseFailures','retries','stoppedByCaps'])report.summary[name]=allTasks.reduce((sum,t)=>sum+(t.metrics[name]||0),0);
    for(const name of ['validationErrors','executionErrors','environmentErrors','providerErrors'])report.summary[name]=allTasks.reduce((sum,t)=>sum+t.metrics[name].length,0);
    report.summary.wallMs=allTasks.reduce((sum,t)=>sum+t.wallMs,0);
    report.summary.tasks=allTasks.length;report.summary.modelTurns=allTasks.reduce((sum,t)=>sum+t.metrics.modelTurns,0);report.summary.reportedTokens=allTasks.some(t=>t.metrics.reportedTokens!==null)?allTasks.reduce((sum,t)=>sum+(t.metrics.reportedTokens||0),0):null;
    write(path.join(runDir,'report.json'),report);
    const table=['| Clip | Reliability (first edit + notes) | Quality | Determinism | Outcome |','| --- | --- | --- | --- | --- |',...report.clips.map(c=>`| ${c.id} | ${(c.tasks||[]).length?c.tasks.every(t=>t.reliabilityStatus==='PASS')?'PASS':'FAIL':'UNAVAILABLE'} | ${(c.tasks||[]).length?c.tasks.every(t=>t.qualityStatus==='PASS')?'PASS':c.tasks.some(t=>t.qualityStatus==='FAIL')?'FAIL':'UNAVAILABLE':'UNAVAILABLE'} | ${c.determinism?.status||'UNAVAILABLE'} | ${c.status} |`)].join('\n');
    fs.writeFileSync(path.join(runDir,'report.md'),`# Eval run\n\nStatus: ${report.status}\n\nBuild: ${report.build.sha||'UNAVAILABLE'} (dirty: ${report.build.dirty})\n\n${table}\n\nTasks including repeats: ${report.summary.tasks}; reliability PASS ${report.summary.reliability.PASS}, FAIL ${report.summary.reliability.FAIL}; quality PASS ${report.summary.quality.PASS}, FAIL ${report.summary.quality.FAIL}, UNAVAILABLE ${report.summary.quality.UNAVAILABLE}. Expected no-audio rejections: ${report.summary.expectedRejections}. Tool calls the harness could not serve (no animation renderer): ${report.summary.environmentErrors}.\n\nLive no-regression: UNAVAILABLE. Human 1-5 and pairwise judging: not run.\n`);
    fs.rmSync(scratch,{recursive:true,force:true});
    console.log(JSON.stringify({runDir,status:report.status}));if(report.status!=='PASS')process.exitCode=1;
  }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
