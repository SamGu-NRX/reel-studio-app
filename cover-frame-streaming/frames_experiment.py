import sys,os,time,json,hashlib,resource,math,subprocess,pathlib
sys.path.insert(0,'~/Programming Projects/reel-studio-app/engine')
os.environ.update(REELENGINE_FFMPEG='/Applications/Reel Studio.app/Contents/Resources/ffmpeg/ffmpeg',REELENGINE_FFPROBE='/Applications/Reel Studio.app/Contents/Resources/ffmpeg/ffprobe',REELENGINE_ROOT='/tmp/rs-perf/root')
from reelengine import project,render,cover,compose_util as u
import numpy as np
S=pathlib.Path('/tmp/rs-perf'); stem,mode=sys.argv[1:];p=S/'projects'/stem;proj=project.load(p);tl=project.timeline(p,proj);ctx=render.make_ctx(p,proj,tl,False,S/'root',p/'work/render');times=cover.candidate_times(ctx,'s1',proj.get('cover',{}).get('atSourceTime'));src=project.source_path(p,proj['sources'][0]);info=u.probe(src,ctx);w=480;h=int(round(info['height']*w/info['width']))//2*2

def stream():
 fps=info['fps'];a=max(0.,times[0]);b=times[-1]+2/fps;t0=round(a,3)
 cmd=[u.ffmpeg_bin(ctx),'-v','error','-nostdin','-ss',f'{a:.3f}','-i',str(src),'-t',f'{b-a:.3f}','-an','-vf',f'scale={w}:{h}:flags=area','-f','rawvideo','-pix_fmt','bgr24','-']
 proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);size=w*h*3;index=-1;buf=b''
 try:
  for t in times:
   k=max(0,int(math.ceil((t-t0)*fps-1e-6)))
   while index<k:
    parts=[];read=0
    while read<size:
     c=proc.stdout.read(size-read)
     if not c: break
     parts.append(c);read+=len(c)
    if read<size: break
    buf=b''.join(parts);index+=1
   if len(buf)==size:yield t,np.frombuffer(buf,np.uint8).reshape(h,w,3)
 finally:
  proc.stdout.close();proc.terminate();proc.wait()
t=time.perf_counter();hashes=[(at,hashlib.sha256(fr.tobytes()).hexdigest()) for at,fr in (u.decode_frames(src,1,w,ctx=ctx,times=times) if mode=='baseline' else stream())];elapsed=time.perf_counter()-t
res={'clip':stem,'mode':mode,'seconds':elapsed,'rss_mib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024**2,'width':w,'height':h,'fps':info['fps'],'hashes':hashes}
(S/f'frames_{stem}_{mode}.json').write_text(json.dumps(res,indent=2));print({k:v for k,v in res.items() if k!='hashes'})
