import { createIcons, AudioLines, ArrowUp, Box, FolderHeart, ImagePlus, MessageCircle, MicOff, Trash2, WandSparkles, X } from 'lucide';
import { createVoice } from './voice.js';

const $ = id => document.getElementById(id);
const icons = { AudioLines, ArrowUp, Box, FolderHeart, ImagePlus, MessageCircle, MicOff, Trash2, WandSparkles, X };
const refreshIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
const jobKey = 'active-job';
const worksKey = 'little-maker-works';
const messageRows = new Map();
let oldestMessage;
let newestMessage = 0;
let historyTimer;
let historyRequest = 0;
let remoteChatBusy = false;
let optimisticUser;
const sections = ['chat', 'make', 'works'];
let activeSection = 'chat';
let currentJob;
let polling = false;
let creating = false;
let fileRead = 0;
let readingImage = false;
let image;
let chatBusy = false;
let voiceState = 'off';
let viewer;
let visibleWork;
let modelRequest = 0;
let saved = [];
let generated = [];
try {
  const works = JSON.parse(localStorage.getItem(worksKey) || '[]');
  if (Array.isArray(works)) saved = works.filter(work => typeof work?.title === 'string');
} catch {}
refreshIcons();
updateGalleryCount();

async function request(url, body, signal) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '服务暂时不可用，请再试一次。');
  return data;
}

function notice(text = '') {
  $('chatNotice').textContent = text;
  $('chatNotice').hidden = !text;
}

function updateConversation() {
  const hasActivity = $('messages').childElementCount > 0 || currentJob || voiceState !== 'off';
  $('welcome').hidden = Boolean(hasActivity);
  $('composeCreation').hidden = !hasActivity;
  $('voicePanel').hidden = voiceState === 'off';
  $('conversation').classList.toggle('voice-only', voiceState !== 'off' && !$('messages').childElementCount);
  $('send').disabled = chatBusy || remoteChatBusy || !$('chatInput').value.trim();
}

function createMessage(role, text, pending = false) {
  const row = document.createElement('div');
  row.className = 'message' + (role === 'user' ? ' user' : '') + (pending ? ' pending' : '');
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.src = '/assets/mascot.webp';
    avatar.alt = '小芽';
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.append(bubble);
  return row;
}

function mergeMessages(messages) {
  const log = $('messages');
  const viewport = $('conversation');
  const stickToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96;
  const first = log.firstElementChild;
  const earlierThan = oldestMessage;
  const firstTemporary = log.querySelector('[data-temporary]');
  for (const message of messages) {
    if (messageRows.has(message.id)) continue;
    if (optimisticUser?.dataset.messageKey === message.key) optimisticUser.remove();
    const row = createMessage(message.role, message.content);
    row.dataset.messageId = message.id;
    row.dataset.messageKey = message.key;
    let next = firstTemporary?.isConnected ? firstTemporary : log.querySelector('[data-temporary]');
    if (message.id < earlierThan && first?.isConnected) next = first;
    else if (message.id < newestMessage) next = Array.from(log.children).find(child => !child.dataset.messageId || Number(child.dataset.messageId) > message.id);
    log.insertBefore(row, next ?? null);
    messageRows.set(message.id, row);
    oldestMessage = Math.min(oldestMessage ?? message.id, message.id);
    newestMessage = Math.max(newestMessage, message.id);
  }
  updateConversation();
  if (stickToBottom) viewport.scrollTop = viewport.scrollHeight;
}

async function syncConversation() {
  const requestId = ++historyRequest;
  clearTimeout(historyTimer);
  try {
    const page = await request('/api/chat');
    if (requestId !== historyRequest) return;
    const gap = page.hasMore && newestMessage && page.messages[0]?.id > newestMessage + 1;
    if (oldestMessage === undefined || gap) $('olderMessages').hidden = !page.hasMore;
    if (gap) {
      for (const row of messageRows.values()) row.remove();
      messageRows.clear();
      oldestMessage = undefined;
      newestMessage = 0;
    }
    remoteChatBusy = page.busy;
    mergeMessages(page.messages);
    if (remoteChatBusy) historyTimer = setTimeout(syncConversation, 1800);
  } catch {
    if (requestId !== historyRequest) return;
    remoteChatBusy = false;
    updateConversation();
    notice('暂时无法读取聊天记录，请稍后刷新。');
  }
}

$('olderMessages').onclick = async () => {
  const button = $('olderMessages');
  if (!oldestMessage || button.disabled) return;
  button.disabled = true;
  try {
    const page = await request('/api/chat?before=' + oldestMessage);
    const viewport = $('conversation');
    const height = viewport.scrollHeight;
    const top = viewport.scrollTop;
    mergeMessages(page.messages);
    button.hidden = !page.hasMore;
    viewport.scrollTop = top + viewport.scrollHeight - height;
  } catch {
    notice('暂时无法读取更早的消息，请再试一次。');
  } finally {
    button.disabled = false;
  }
};

async function sendTurn(input, signal) {
  const storyJob = currentJob?.status === 'running' ? currentJob : null;
  chatBusy = true;
  remoteChatBusy = false;
  notice();
  const id = crypto.randomUUID();
  const optimistic = input.text ? createMessage('user', input.text) : null;
  const pending = createMessage('assistant', input.audio ? '小芽正在听你的语音…' : '小芽正在想…', true);
  pending.dataset.temporary = '';
  const log = $('messages');
  if (optimistic) {
    optimistic.dataset.temporary = '';
    optimistic.dataset.messageKey = id + ':user';
    optimisticUser = optimistic;
    log.append(optimistic);
  }
  log.append(pending);
  updateConversation();
  $('conversation').scrollTop = $('conversation').scrollHeight;
  try {
    const reply = await request('/api/chat', { ...input, id, title: currentJob?.title }, signal);
    if (typeof reply.text !== 'string') throw new Error('小芽这次没有回复，请再试一次。');
    optimistic?.remove();
    pending.remove();
    mergeMessages(reply.messages);
    const author = reply.messages?.find(message => message.role === 'user');
    const row = messageRows.get(author?.id);
    if (storyJob && row && author.content?.length <= 120 && !row.querySelector('.keep-story')) {
      const keep = document.createElement('button');
      keep.className = 'keep-story';
      keep.textContent = '用这句话做作品故事';
      keep.setAttribute('aria-label', '把这句话存进「' + storyJob.title + '」');
      keep.onclick = async () => {
        keep.disabled = true;
        try {
          await request('/api/jobs/' + storyJob.id + '/story', {story:author.content});
          keep.textContent = '已存进「' + storyJob.title + '」';
        } catch (error) { keep.disabled = false; notice(error.message); }
      };
      row.querySelector('.bubble').append(keep);
    }
    return reply.text;
  } catch (error) {
    optimistic?.remove();
    pending.remove();
    await syncConversation();
    const arrived = Array.from(messageRows.values()).some(row => row.dataset.messageKey === id + ':user');
    if (input.text && !arrived && !$('chatInput').value) $('chatInput').value = input.text;
    throw error;
  } finally {
    optimistic?.remove();
    optimisticUser = null;
    pending.remove();
    chatBusy = false;
    updateConversation();
  }
}

const voice = createVoice({
  onState(state) {
    voiceState = state;
    const labels = { starting: '正在打开麦克风…', listening: '正在听，你可以说话', thinking: '小芽正在想…', speaking: '小芽正在回答' };
    $('voicePanel').dataset.state = state;
    $('voiceStatus').textContent = labels[state] || '';
    const active = state !== 'off';
    const button = $('voice');
    const label = active ? '结束语音聊天' : '开始语音聊天';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = active ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="audio-lines"></i>';
    refreshIcons();
    updateConversation();
  },
  onAudio(audio, signal) {
    if (chatBusy || remoteChatBusy) throw new Error('小芽正在回复上一条消息，请稍后再说。');
    return sendTurn({ audio }, signal);
  },
  onError: notice,
});

$('voice').onclick = () => {
  notice();
  if (voice.active) voice.stop();
  else void voice.start();
};
window.addEventListener('pagehide', () => voice.stop());
$('chatInput').addEventListener('input', updateConversation);
$('chatForm').onsubmit = async event => {
  event.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text || chatBusy || remoteChatBusy) return;
  $('chatInput').value = '';
  const shouldSpeak = voice.pauseForText();
  try {
    const reply = await sendTurn({ text });
    if (shouldSpeak) voice.speak(reply);
  } catch (error) {
    notice(error.message);
    if (shouldSpeak) voice.speak();
  }
};

function showSection(section) {
  if (section !== 'chat' && voice.active) voice.stop();
  activeSection = section;
  for (const id of sections) {
    const selected = id === section;
    $(id).hidden = !selected;
    const link = document.querySelector(`[data-section="${id}"]`);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (section === 'make') updateCreation();
  if (section === 'works') renderGallery();
  if (section === 'chat') $('conversation').scrollTop = $('conversation').scrollHeight;
}

function sectionFromHash() {
  const section = location.hash.slice(1);
  return sections.includes(section) ? section : 'chat';
}

function navigateTo(section) {
  if (location.hash !== '#' + section) location.hash = section;
  if (activeSection !== section) showSection(section);
}

function openCreation() {
  navigateTo('make');
}
$('openCreation').onclick = openCreation;
$('composeCreation').onclick = openCreation;
$('drop').onclick = () => $('file').click();
for (const name of ['dragover', 'dragleave', 'drop']) {
  $('drop').addEventListener(name, event => {
    event.preventDefault();
    $('drop').classList.toggle('drag', name === 'dragover');
    if (name === 'drop') loadFile(event.dataTransfer.files[0]);
  });
}
$('file').onchange = event => {
  loadFile(event.target.files[0]);
  event.target.value = '';
};

function formError(text = '') {
  $('error').textContent = text;
  $('error').hidden = !text;
}
function updateCreation() {
  const running = currentJob?.status === 'running';
  $('makeStatus').hidden = !running;
  $('create').disabled = !image || creating || readingImage || running;
}
function setImage(data) {
  image = data;
  readingImage = false;
  $('original').src = data;
  $('original').hidden = false;
  $('uploadEmpty').hidden = true;
  updateCreation();
  formError();
}
function loadFile(file) {
  if (!file || creating) return;
  const read = ++fileRead;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    readingImage = false;
    updateCreation();
    formError('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。');
    return;
  }
  const reader = new FileReader();
  readingImage = true;
  updateCreation();
  reader.onload = () => { if (read === fileRead) setImage(reader.result); };
  reader.onerror = () => {
    if (read !== fileRead) return;
    readingImage = false;
    updateCreation();
    formError('画作读取失败，请重新选择。');
  };
  reader.readAsDataURL(file);
}
$('sample').onclick = () => {
  if (creating) return;
  ++fileRead;
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 450;
  const pen = canvas.getContext('2d');
  pen.fillStyle = '#fffdf5';
  pen.fillRect(0, 0, 600, 450);
  function oval(x, y, rx, ry, color, rotation = 0) {
    pen.beginPath();
    pen.ellipse(x, y, rx, ry, rotation, 0, 2 * Math.PI);
    pen.fillStyle = color;
    pen.fill();
    pen.lineWidth = 4;
    pen.strokeStyle = '#8c7d69';
    pen.stroke();
  }
  oval(255, 119, 22, 72, '#f0dfbe', -.17);
  oval(341, 111, 21, 77, '#f0dfbe', .15);
  oval(300, 299, 63, 77, '#a0ba8b');
  oval(300, 207, 84, 67, '#f6e7c9');
  oval(272, 200, 4, 5, '#675245');
  oval(329, 200, 4, 5, '#675245');
  oval(301, 222, 5, 3, '#efa995');
  oval(252, 369, 29, 13, '#f6e7c9');
  oval(346, 369, 29, 13, '#f6e7c9');
  setImage(canvas.toDataURL('image/png'));
  $('name').value = '收集星星的小兔';
  $('story').value = '它会把收集来的星光分给朋友。';
};

$('creationForm').onsubmit = async event => {
  event.preventDefault();
  if (!image || creating || readingImage || currentJob?.status === 'running') return;
  creating = true;
  formError();
  updateCreation();
  $('createLabel').textContent = '正在提交…';
  try {
    const job = await request('/api/jobs', { image, title: $('name').value.trim(), story: $('story').value.trim() });
    try { localStorage.setItem(jobKey, job.id); } catch {}
    renderJob(job);
    navigateTo('chat');
    void syncConversation();
    void pollJob(job.id);
  } catch (error) {
    if (activeSection === 'make') formError(error.message);
    else notice(error.message);
  } finally {
    creating = false;
    updateCreation();
    $('createLabel').textContent = '开始生成';
  }
};

// The API reports stages, so each value represents an estimated milestone.
const stageProgress = new Map([
  ['准备开始', 5],
  ['正在理解画作', 10],
  ['正在塑造小伙伴', 25],
  ['正在完善小伙伴的造型', 40],
  ['正在提交立体创作', 55],
  ['正在构建立体模型', 65],
  ['正在准备作品展示', 95],
]);

const buildProgressKey = 'little-maker-build-progress';
let buildProgress;
try {
  buildProgress = JSON.parse(localStorage.getItem(buildProgressKey));
} catch {}

function estimatedBuildProgress(job) {
  const now = Date.now();
  if (buildProgress?.id !== job.id || !Number.isFinite(buildProgress.startedAt)) {
    buildProgress = { id: job.id, startedAt: now };
    try { localStorage.setItem(buildProgressKey, JSON.stringify(buildProgress)); } catch {}
  }
  // Update in small steps, with longer pauses as the estimate nears 98%.
  const steps = Math.floor(Math.max(0, now - buildProgress.startedAt) / 8000);
  return Math.min(98, 65 + Math.floor(34 * (1 - Math.exp(-steps / 10))));
}

function renderJobProgress(job) {
  const progress = $('jobProgress');
  const previous = progress.getAttribute('aria-valuenow');
  const interrupted = job.status === 'failed' || job.status === 'disconnected';
  let value = stageProgress.get(job.stage);
  if (job.status === 'running' && job.stage === '正在构建立体模型') {
    value = estimatedBuildProgress(job);
  }
  if (job.status === 'running' && job.stage === '正在准备作品展示' && buildProgress?.id === job.id) {
    value = Math.max(value, estimatedBuildProgress(job));
  }
  if (job.status === 'succeeded') value = 100;
  if (currentJob?.id === job.id && previous !== null) {
    if (interrupted) value = Number(previous);
    else if (job.status === 'running' && value !== undefined) value = Math.max(value, Number(previous));
  }
  $('jobProgressRow').hidden = interrupted && value === undefined;
  if (value === undefined) {
    progress.removeAttribute('aria-valuenow');
    progress.removeAttribute('aria-valuetext');
  } else {
    progress.setAttribute('aria-valuenow', String(value));
    progress.setAttribute('aria-valuetext', value === 100 ? '已完成' : `约 ${value}%`);
  }
  $('jobProgressFill').style.width = value === undefined ? '' : `${value}%`;
  $('jobProgressLabel').textContent = value === undefined ? '' : value === 100 ? '100%' : `约 ${value}%`;
}

function renderJob(job) {
  const jobChanged = currentJob?.id !== job.id || currentJob?.status !== job.status;
  renderJobProgress(job);
  if (currentJob?.id !== job.id) {
    $('storyAnswer').value = ''; $('storyNotice').textContent = ''; $('storyBox').open = false;
  }
  $('storyBox').hidden = !['running', 'succeeded'].includes(job.status);
  $('storyQuestion').textContent = '「' + (job.title || '小伙伴') + '」有什么只有你知道的秘密？';
  currentJob = job;
  const card = $('jobCard');
  const action = $('jobAction');
  card.hidden = false;
  card.dataset.state = job.status;
  $('jobTitle').textContent = job.title || '3D 作品';
  const status = job.error || job.stage;
  if ($('jobStatus').textContent !== status) $('jobStatus').textContent = status;
  action.hidden = !['succeeded', 'failed', 'disconnected'].includes(job.status);
  action.textContent = job.status === 'succeeded' ? '查看作品' : job.status === 'disconnected' ? '重新查询' : '重新制作';
  action.onclick = job.status === 'succeeded'
    ? () => void openModel({ id: job.id, title: job.title, modelUrl: job.modelUrl })
    : job.status === 'disconnected' ? () => void pollJob(job.id) : openCreation;
  updateConversation();
  updateCreation();
  if (activeSection === 'works' && jobChanged) renderGallery();
}

async function pollJob(id) {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      const job = await request('/api/jobs/' + id);
      renderJob(job);
      if (job.status !== 'running') {
        if (job.status === 'succeeded') {
          void syncConversation();
          void syncWorks();
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
  } catch (error) {
    renderJob({ ...currentJob, id, status: 'disconnected', error: error.message });
  } finally {
    polling = false;
  }
}

const activeJob = localStorage.getItem(jobKey);
if (activeJob && /^[a-f0-9-]{36}$/.test(activeJob)) {
  renderJob({ id: activeJob, status: 'running', stage: '正在查询制作进度' });
  void pollJob(activeJob);
}

async function syncWorks() {
  try {
    const archive = await request('/api/jobs');
    generated = archive.works;
    updateGalleryCount();
    if (activeSection === 'works') renderGallery();
    if (!currentJob && archive.activeJob) {
      renderJob(archive.activeJob);
      void pollJob(archive.activeJob.id);
    }
  } catch {
    if (activeSection === 'works' && !generated.length && !saved.length) {
      $('galleryItems').textContent = '暂时无法读取作品，请稍后刷新。';
    }
  }
}

function galleryWorks() {
  const works = [...generated];
  if (currentJob?.status === 'succeeded' && !works.some(work => work.modelUrl === currentJob.modelUrl)) works.unshift(currentJob);
  for (const work of saved) {
    if (!work.modelUrl || !works.some(item => item.modelUrl === work.modelUrl)) works.push(work);
  }
  return works;
}

function updateGalleryCount() {
  const count = galleryWorks().length;
  $('count').textContent = count;
  $('count').hidden = !count;
}
function updateSaveButton() {
  const exists = saved.some(work => work.modelUrl === visibleWork?.modelUrl);
  $('save').textContent = exists ? '已收藏' : '收藏作品';
  $('save').disabled = exists;
}
let featured = [];
async function loadFeatured() {
  try {
    const entries = await request('/cases/index.json');
    featured = entries.filter(entry => /^[a-z-]+$/.test(entry.id)).map(entry => ({
      ...entry, modelUrl: '/cases/' + entry.id + '.glb', drawing: '/cases/' + entry.id + '.png'
    }));
    for (const button of document.querySelectorAll('[data-featured]')) {
      button.hidden = !featured.length;
      button.onclick = () => openModel(featured[0]);
    }
  } catch { /* The personal gallery remains available offline. */ }
}
void loadFeatured();
$('storyForm').onsubmit = async event => {
  event.preventDefault();
  const jobId = currentJob?.id;
  const story = $('storyAnswer').value.trim();
  if (!jobId || !story) return;
  try {
    await request('/api/jobs/' + jobId + '/story', {story});
    if (currentJob?.id === jobId) $('storyNotice').textContent = '已经存进作品啦。';
  } catch(error) { $('storyNotice').textContent = error.message; }
};
async function openModel(work) {
  const example = featured.find(item => item.modelUrl === work.modelUrl);
  if (!example && !/^\/api\/jobs\/[a-f0-9-]{36}\/model$/.test(work.modelUrl || '')) {
    notice('这条早期演示记录没有可加载的模型。');
    return;
  }
  const run = ++modelRequest;
  visibleWork = work;
  $('caseDrawing').hidden = !example;
  if (example) $('caseImage').src = example.drawing;
  $('caseTabs').hidden = !example || featured.length < 2;
  $('caseTabs').replaceChildren();
  if (example) for (const item of featured) {
    const btn = document.createElement('button');
    btn.className = 'small-button'; btn.textContent = item.title;
    btn.disabled = item === example;
    btn.onclick = () => openModel(item);
    $('caseTabs').append(btn);
  }
  $('authorStory').textContent = example?.story || '';
  $('authorStory').hidden = !example?.story;
  if (!example) void request(work.modelUrl.replace(/model$/, 'story')).then(({story}) => {
    if (run === modelRequest) { $('authorStory').textContent = story; $('authorStory').hidden = !story; }
  }).catch(() => {});

  $('resultTitle').textContent = work.title;
  $('modelTools').hidden = true;
  $('modelStatus').textContent = '正在打开作品…';
  if (!$('modelDialog').open) $('modelDialog').showModal();
  try {
    if (!viewer) {
      const { createViewer } = await import('./viewer.js');
      viewer ||= createViewer($('viewer'));
    }
    if (run !== modelRequest) return;
    await viewer.load(work.modelUrl);
    if (run !== modelRequest) return;
    $('downloadModel').href = work.modelUrl;
    $('rotate').textContent = '自动旋转';
    updateSaveButton();
    $('modelStatus').textContent = '拖动旋转，滚动或双指缩放。';
    $('modelTools').hidden = false;
  } catch {
    if (run === modelRequest) $('modelStatus').textContent = '作品暂时无法打开，请关闭后再试。';
  }
}
$('rotate').onclick = () => { $('rotate').textContent = viewer.toggle() ? '暂停旋转' : '自动旋转'; };
$('resetView').onclick = () => viewer.reset();
$('save').onclick = () => {
  if (!visibleWork || saved.some(work => work.modelUrl === visibleWork.modelUrl)) return;
  saved.unshift({ ...visibleWork, date: new Date().toLocaleDateString('zh-CN') });
  persistWorks();
  updateSaveButton();
  if (activeSection === 'works') renderGallery();
};
function persistWorks() {
  try { localStorage.setItem(worksKey, JSON.stringify(saved)); }
  catch { notice('浏览器无法保存收藏，当前页面仍保留这次更改。'); }
  updateGalleryCount();
}
function renderGallery() {
  const list = $('galleryItems');
  list.replaceChildren();
  const works = galleryWorks();
  if (!works.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有作品。去「制作」做你的第一个 3D 伙伴吧。';
    list.append(empty);
    return;
  }
  for (const work of works) {
    const favorite = saved.find(item => item === work || (work.modelUrl && item.modelUrl === work.modelUrl));
    const row = document.createElement('div');
    row.className = 'work-row';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = work.title;
    const date = document.createElement('small');
    date.textContent = favorite ? '已收藏' : '';
    info.append(title);
    if (favorite) info.append(date);
    const show = document.createElement('button');
    show.className = 'small-button';
    show.textContent = work.modelUrl ? '查看' : '旧演示记录';
    show.disabled = !work.modelUrl;
    show.onclick = () => void openModel(work);
    row.append(info, show);
    if (!favorite) {
      list.append(row);
      continue;
    }
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.setAttribute('aria-label', '移除收藏 ' + work.title);
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.onclick = () => {
      saved = saved.filter(item => item !== favorite);
      persistWorks();
      renderGallery();
    };
    row.append(remove);
    list.append(row);
  }
  refreshIcons();
}
window.addEventListener('hashchange', () => {
  const section = sectionFromHash();
  if (section !== activeSection) showSection(section);
});
showSection(sectionFromHash());
void syncConversation();
void syncWorks();
window.addEventListener('focus', () => {
  void syncConversation();
  void syncWorks();
});

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}
