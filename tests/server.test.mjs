import test from 'node:test';
import assert from 'node:assert/strict';
import {providers,publicJob,validateInput} from '../server/providers.mjs';
test('public status excludes provider IDs, private prompts and reference URLs',()=>{
 const d=publicJob({id:'a',title:'兔',status:'running',stage:'制作中',taskId:123,reference:'https://private',prompt:'secret',apiKey:'secret'});
 assert.deepEqual(Object.keys(d).sort(),['error','id','modelUrl','stage','status','title']);assert.equal(d.modelUrl,null);
});
test('rejects remote URL uploads and oversized input',()=>{
 assert.throws(()=>validateInput({image:'https://internal'}));
 assert.throws(()=>validateInput({image:'data:image/png;base64,'+'A'.repeat(15*1024*1024)}));
});
test('valid upload preserves image and bounds user fields',()=>{
 const d=validateInput({image:'data:image/png;base64,YQ==',title:'x'.repeat(40),story:'y'.repeat(200)});assert.equal(d.title.length,20);assert.equal(d.story.length,120);
});
test('Aholo task failures surface safely without provider message secrets',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({c:'401',m:'SECRET_KEY'}),{status:401});
 try{await assert.rejects(providers({AHOLO_BASE_URL:'https://example.test',AHOLO_API_KEY:'secret'}).queryTask(1),e=>!e.message.includes('SECRET_KEY')&&e.message.includes('401'));}
 finally{globalThis.fetch=original;}
});
test('provider parses GLB query response',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({c:'0',d:{status:3,outputs:[{content:'https://example.test/model.glb'}]}}));
 try{const d=await providers({AHOLO_BASE_URL:'https://example.test'}).queryTask(1);assert.equal(d.status,3);assert.equal(d.outputs.length,1);}
 finally{globalThis.fetch=original;}
});

test('passes original drawing and prompt to Image, then uses three-quarter, side and back for Lux3D', async (t) => {
  const original = 'data:image/png;base64,YQ==';
  const front = 'https://cdn.example.test/front.png';
  const side = 'https://cdn.example.test/side.png';
  const back = 'https://cdn.example.test/back.png';
  const api = providers({ IMAGE_BASE_URL:'https://image.example.test/generate', AHOLO_BASE_URL:'https://3d.example.test', LUX3D_MODEL:'G1' });
  const requests = [];
  const imageResult = image => ({output:{choices:[{message:{content:[{image}]}}]}});
  const responses = [
    imageResult(front),
    imageResult(side),
    imageResult(back),
    {c:'0',d:20},
  ];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url,body:options.body && JSON.parse(options.body)});
    return Response.json(responses.shift());
  });
  const reference = await api.image(original,'戴黄帽子的小狗');
  const views = await api.createViews(reference);
  assert.equal(await api.create3d(views), 20);
  const content = requests[0].body.input.messages[0].content;
  assert.equal(content[0].image, original);
  assert.match(content[1].text, /戴黄帽子的小狗/);
  const sideInput = requests[1].body.input.messages[0].content;
  const backInput = requests[2].body.input.messages[0].content;
  assert.equal(sideInput[0].image, front);
  assert.equal(backInput[0].image, front);
  assert.match(content[1].text, /三分之四视角/);
  assert.match(sideInput[1].text, /右侧正交侧视图/);
  assert.match(backInput[1].text, /正后方正交背视图/);
  assert.deepEqual(requests[3].body.imgs, [front, side, back]);
  assert.equal(requests[3].body.version, 'G1');
  assert.ok(!('img' in requests[3].body));
});

test('rejects duplicate multi-view outputs', async (t) => {
  const front = 'https://cdn.example.test/front.png';
  t.mock.method(globalThis, 'fetch', async () => Response.json({output:{choices:[{message:{content:[{image:front}]}}]}}));
  await assert.rejects(providers({IMAGE_BASE_URL:'https://image.example.test/generate'}).createViews(front), /造型生成未完成/);
});
