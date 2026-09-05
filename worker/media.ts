export interface Assets { fetch(request: Request): Promise<Response> }
interface Part { path: string; size: number }
interface Manifest { size: number; sha256: string; parts: Part[] }

export async function serveVideo(request: Request, assets: Assets): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
  const url = new URL(request.url);
  const meta = await assets.fetch(new Request(new URL('/media/manifest.json', url)));
  if (!meta.ok) return new Response('Video not published', {status:404});
  const m = await meta.json() as Manifest;
  if (!Number.isSafeInteger(m.size) || m.size <= 0 || m.size > 256*1024*1024 ||
      !/^[a-f0-9]{64}$/.test(m.sha256) || !Array.isArray(m.parts) || !m.parts.length || m.parts.length > 32 ||
      m.parts.some(p => !/^\/media\/parts\/[a-f0-9]{12}-\d{2}\.bin$/.test(p.path) || !Number.isSafeInteger(p.size) || p.size <= 0 || p.size > 16*1024*1024) ||
      m.parts.reduce((n,p) => n+p.size,0) !== m.size) return new Response('Invalid media manifest', {status:503});
  const etag = '"'+m.sha256+'"';
  const headers = new Headers({'Content-Type':'video/mp4','Accept-Ranges':'bytes','ETag':etag,
    'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff',
    'Content-Disposition':(url.searchParams.has('download')?'attachment':'inline')+'; filename="fairjoin-2min-mimo.mp4"'});
  if (request.headers.get('If-None-Match')?.split(',').map(s=>s.trim()).includes(etag)) return new Response(null,{status:304,headers});
  let start=0,end=m.size-1,partial=false;
  const range=request.method==='GET'?request.headers.get('Range'):null;
  if (range && (!request.headers.has('If-Range') || request.headers.get('If-Range')===etag)) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1]&&!match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.size}`}});
    if (!match[1]) { const suffix=Number(match[2]); if(!Number.isSafeInteger(suffix)||suffix<=0) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.size}`}}); start=Math.max(0,m.size-suffix); }
    else { start=Number(match[1]); end=match[2]?Math.min(Number(match[2]),m.size-1):end; }
    if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=m.size||end<start) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.size}`}});
    partial=true;headers.set('Content-Range',`bytes ${start}-${end}/${m.size}`);
  }
  headers.set('Content-Length',String(end-start+1));
  if(request.method==='HEAD')return new Response(null,{status:200,headers});
  async function* bytes(): AsyncGenerator<Uint8Array> {
    let offset=0;
    for (const part of m.parts) {
      const partStart=offset;offset+=part.size;
      if(offset<=start||partStart>end)continue;
      const a=Math.max(0,start-partStart),z=Math.min(part.size-1,end-partStart);
      const response=await assets.fetch(new Request(new URL(part.path,url),{headers:{Range:`bytes=${a}-${z}`},signal:request.signal}));
      if(!response.body||![200,206].includes(response.status))throw new Error('Media part unavailable');
      if(response.status===206 && response.headers.get('Content-Range')!==`bytes ${a}-${z}/${part.size}`)throw new Error('Unexpected media range');
      const reader=response.body.getReader();let skip=response.status===206?0:a,remaining=z-a+1;
      try {
        while(remaining>0){const next=await reader.read();if(next.done)throw new Error('Truncated media part');let data=next.value;
          if(skip){const n=Math.min(skip,data.length);skip-=n;data=data.subarray(n);}
          if(!data.length)continue;const n=Math.min(data.length,remaining);remaining-=n;yield data.subarray(0,n);
        }
      } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
  }
  const iterator=bytes();
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){try{const value=await iterator.next();if(value.done)controller.close();else controller.enqueue(value.value);}catch(error){controller.error(error);}},
    async cancel(){await iterator.return(undefined);}
  });
  return new Response(body,{status:partial?206:200,headers});
}
