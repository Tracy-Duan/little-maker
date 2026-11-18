import http from 'node:http';
import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadEnv} from 'vite';
import {providers,publicJob,validateInput} from './providers.mjs';
import {openConversation} from './conversation.mjs';
const env=loadEnv('development',process.cwd(),'');
const profile = process.env.DEMO_PROFILE || 'default';
if (!/^[a-z0-9-]+$/.test(profile)) throw new Error('Invalid demo profile');
const api=providers(env), dir=new URL(profile === 'default' ? '../.server-data/' : '../.server-data/' + profile + '/',import.meta.url);
await mkdir(dir,{recursive:true});
const conversation = openConversation(fileURLToPath(new URL('conversation.sqlite', dir)));
const jobs=new Map(),running=new Set();
const path=(id,ext='json')=>new URL(`${id}.${ext}`,dir);
async function persist(j) {
 const tmp = path(j.id, randomUUID()+'.tmp');
 await writeFile(tmp, JSON.stringify(j));
 for (let attempt = 0; ; attempt++) {
   try { await rename(tmp, path(j.id)); return; }
   catch (error) {
     if (attempt >= 5 || !['EBUSY','EPERM'].includes(error.code)) throw error;
     await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
   }
 }
}
for(const f of await readdir(dir))if(f.endsWith('.json')){try{const j=JSON.parse(await readFile(new URL(f,dir)));jobs.set(j.id,j);}catch{}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function recordJobEvent(job, event, text) {
  try { conversation.record('job:' + job.id + ':' + event, 'assistant', text, 'event'); }
  catch { console.error('Could not save the 3D job event'); }
}
async function waitForLuxTask(job, taskId, label) {
  while (Date.now() - job.created < 45 * 60 * 1000) {
    const result = await api.queryTask(taskId);
    if (result?.status === 3) return result;
    if ([4, 6].includes(result?.status)) throw new Error(label + '失败，请重新制作');
    if (![0, 1].includes(result?.status)) throw new Error(label + '返回了无法识别的状态');
    await sleep(5000);
  }
  throw new Error('等待超过 45 分钟，请保留任务编号联系开发者');
}

async function run(j,input){
 running.add(j.id);
 try{
  if(!j.taskId){
   j.stage='正在理解画作';await persist(j);
   const description=await api.describe(input);
   j.stage='正在塑造小伙伴';await persist(j);
   const front=await api.image(input.image,description);
   j.stage='正在完善小伙伴的造型';await persist(j);
   const views=await api.createViews(front);
   j.stage='正在提交立体创作';await persist(j);
   // Only the mesh task ID is persisted. Intermediate images stay on the server.
   j.taskId=await api.create3d(views);await persist(j);
  }
  j.stage='正在构建立体模型';await persist(j);
  const result=await waitForLuxTask(j,j.taskId,'3D 生成');
  const url=result.outputs?.map(x=>x.content).find(x=>typeof x==='string'&&/^https:\/\//.test(x)&&/\.glb(?:\?|$)/i.test(x));
  if(!url)throw new Error('3D 服务未返回 GLB 模型');
  j.stage='正在准备作品展示';await persist(j);
  let response;
  try {
    response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  } catch {
    throw new Error('模型下载超时，请保留任务编号联系开发者');
  }
  if(!response.ok)throw new Error('模型下载失败，请保留任务编号联系开发者');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>200*1024*1024)throw new Error('模型文件超过 200 MB 限制');chunks.push(chunk);}
  const model=Buffer.concat(chunks);
  if(model.subarray(0,4).toString()!=='glTF')throw new Error('返回文件不是有效 GLB');
  await writeFile(path(j.id,'glb'),model);
  const completed = { ...j, status: 'succeeded', stage: '作品已完成' };
  await persist(completed);
  recordJobEvent(j, 'complete', '「' + j.title + '」做好啦。可以在「作品」里查看。');
  Object.assign(j, completed);
 }catch(e){j.status='failed';j.error=e.message;j.stage='生成暂未完成';await persist(j);}
 finally{running.delete(j.id);}
}
for(const j of jobs.values())if(j.status==='running'){
 if(j.taskId)void run(j);
 else{j.status='failed';j.error='服务重启，中断的生成未自动重试，请重新提交';await persist(j);}
}
let chatBusy=false,lastChat=0;
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=http.createServer(async(req,res)=>{
 try{
  // This release is intentionally local-only. No cross-origin mutations.
  if(!['localhost','127.0.0.1'].includes((req.headers.host||'').split(':')[0]))return reply(res,403,{error:'仅支持本机访问'});
  if(req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin))return reply(res,403,{error:'来源不允许'});
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')return reply(res,200,{ready:['LLM_API_KEY','LLM_BASE_URL','LLM_MODEL','IMAGE_API_KEY','IMAGE_BASE_URL','IMAGE_MODEL','AHOLO_API_KEY'].every(k=>!!env[k])});
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
   const archive = [...jobs.values()].sort((a, b) => b.created - a.created);
   const activeJob = archive.find(job => job.status === 'running');
   return reply(res, 200, {
    activeJob: activeJob ? publicJob(activeJob) : null,
    works: archive.filter(job => job.status === 'succeeded').map(publicJob),
   });
  }
  if(req.method==='POST'&&url.pathname==='/api/jobs'){
   if(running.size)return reply(res,409,{error:'已有作品正在制作，请等待完成'});
   if([...jobs.values()].filter(j=>Date.now()-j.created<86400000).length>=20)return reply(res,429,{error:'本地试用每天最多创建 20 次，请明天再试'});
   const input=validateInput(await body(req));
   if(running.size)return reply(res,409,{error:'已有作品正在制作'});
   const j={id:randomUUID(),title:input.title,status:'running',stage:'准备开始',created:Date.now()};jobs.set(j.id,j);running.add(j.id);await persist(j);
   recordJobEvent(j, 'start', '开始制作「' + j.title + '」了。等待时，我们可以接着聊。');
   void run(j,input);return reply(res,202,publicJob(j));
  }
  const storyMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/story$/);
  if (storyMatch && jobs.has(storyMatch[1])) {
    const target = path(storyMatch[1], 'story.txt');
    if (req.method === 'GET') {
      let story = '';
      try { story = await readFile(target, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      return reply(res, 200, {story});
    }
    if (req.method === 'POST') {
      const story = (await body(req)).story;
      if (typeof story !== 'string' || !story.trim() || story.length > 120) return reply(res, 400, {error:'请输入 1 至 120 字的故事'});
      const temp = path(storyMatch[1], randomUUID()+'.tmp');
      await writeFile(temp, story.trim()); await rename(temp, target);
      return reply(res, 200, {story:story.trim()});
    }
  }
  const match=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/model)?$/);
  if(req.method==='GET'&&match){const j=jobs.get(match[1]);if(!j)return reply(res,404,{error:'任务不存在'});
   if(!match[2])return reply(res,200,publicJob(j));
   if(j.status!=='succeeded')return reply(res,409,{error:'模型尚未就绪'});
   res.writeHead(200,{'Content-Type':'model/gltf-binary','Cache-Control':'private, max-age=3600'});createReadStream(path(j.id,'glb')).pipe(res);return;
  }
  if (req.method === 'GET' && url.pathname === '/api/chat') {
   const before = Number(url.searchParams.get('before'));
   if (!Number.isSafeInteger(before) || before < 0) return reply(res,400,{error:'历史记录位置无效'});
   return reply(res, 200, { ...conversation.page(before), busy: chatBusy });
  }
  if(req.method==='POST'&&url.pathname==='/api/chat'){
   if(chatBusy||Date.now()-lastChat<3000)return reply(res,429,{error:'小芽正在思考，请稍等'});
   const b=await body(req);
   const message=typeof b.text==='string'?b.text.trim():'';
   const audio=typeof b.audio==='string'&&b.audio.length<=2_000_000&&/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(b.audio)?b.audio:undefined;
   if((!message&&!audio)||message.length>500)return reply(res,400,{error:'请输入 500 字以内的消息，或录制一段语音'});
   if(chatBusy||Date.now()-lastChat<3000)return reply(res,429,{error:'小芽正在思考，请稍等'});
   chatBusy=true;lastChat=Date.now();
   try {
    const key = typeof b.id === 'string' && /^[a-f0-9-]{36}$/.test(b.id) ? b.id : randomUUID();
    const lastReply = conversation.find(key + ':reply');
    if (lastReply) {
     const lastUser = conversation.find(key + ':user');
     return reply(res, 200, { text:lastReply.content, heard:audio ? lastUser.content : undefined, messages:[lastUser,lastReply] });
    }
    const userMessage = audio ? null : conversation.record(key + ':user', 'user', message);
    const history = conversation.recentContext(userMessage?.id);
    const result = await api.chat({text:userMessage?.content ?? message,audio,title:String(b.title||'').slice(0,20),history});
    const messages = audio
      ? conversation.recordAudioTurn(key, result.heard, result.text)
      : [userMessage, conversation.record(key + ':reply', 'assistant', result.text)];
    return reply(res, 200, { ...result, messages });
   } finally { chatBusy=false; }
  }
  reply(res,404,{error:'接口不存在'});
 }catch(e){reply(res,400,{error:e instanceof SyntaxError?'请求格式错误':e.message});}
});
server.listen(Number(process.env.PORT || 3001),'127.0.0.1',()=>console.log('Backend ready'));
