import { serveVideo } from './media';
interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }
export default {
 async fetch(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url);
  if(url.pathname==="/health") return Response.json({product:"FAIRJOIN",chainId:10143,mode:"testnet",asset:"FJUSD (no value)",privateKeysOnServer:false},{headers:{"Cache-Control":"no-store"}});
  if(url.pathname==='/media/fairjoin-2min.mp4') return serveVideo(request,env.ASSETS);
  if(url.pathname==='/media/fairjoin-4min.mp4') return Response.redirect(new URL('/demo/',url).toString(),302);
  return env.ASSETS.fetch(request);
 }
};
