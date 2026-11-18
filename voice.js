export function createVoice({ onState, onAudio, onError }) {
  let session = null;
  let phase = 'off';
  let chunks = [];
  let duration = 0;
  let lastSound = 0;
  let startedTalking = false;
  let speech = null;

  function setPhase(next) {
    phase = next;
    onState(next);
  }

  function listen() {
    chunks = [];
    duration = 0;
    lastSound = 0;
    startedTalking = false;
    setPhase('listening');
  }

  async function receive(samples, current) {
    if (session !== current || phase !== 'listening') return;
    const ms = samples.length / current.context.sampleRate * 1000;
    const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    chunks.push(samples);
    duration += ms;
    if (level > .013) {
      lastSound = duration;
      startedTalking = true;
    }
    if (!startedTalking) {
      if (duration > 400) {
        duration -= chunks.shift().length / current.context.sampleRate * 1000;
      }
      return;
    }
    if (duration < 24000 && (duration - lastSound < 950 || lastSound < 250)) {
      if (duration - lastSound > 1800) listen();
      return;
    }
    setPhase('thinking');
    const controller = new AbortController();
    current.turn = controller;
    try {
      const audio = await wavData(chunks, current.context.sampleRate);
      if (session !== current) return;
      const reply = await onAudio(audio, controller.signal);
      if (session === current && phase === 'thinking') speak(reply);
    } catch (error) {
      if (session !== current) return;
      onError(error.message);
      listen();
    } finally {
      if (current.turn === controller) current.turn = null;
    }
  }

  async function start() {
    if (session) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      onError('当前浏览器无法使用麦克风，请用文字聊天，或在 Chrome / Edge 中打开。');
      return;
    }
    const current = {};
    session = current;
    setPhase('starting');
    try {
      current.context = new AudioContext();
      await current.context.resume();
      if (session !== current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (session !== current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      current.stream = stream;
      stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (session === current) {
          stop();
          onError('麦克风已断开，请重新开启语音。');
        }
      });
      await current.context.audioWorklet.addModule('/microphone-worklet.js');
      if (session !== current) return;
      const capture = new AudioWorkletNode(current.context, 'microphone-capture');
      capture.port.onmessage = ({ data }) => void receive(data, current);
      current.capture = capture;
      current.context.createMediaStreamSource(stream).connect(capture).connect(current.context.destination);
      listen();
    } catch (error) {
      if (session !== current) return;
      stop();
      onError(error.name === 'NotAllowedError' ? '请在浏览器中允许麦克风访问，或继续用文字聊天。' : '无法开启麦克风，请检查设备后重试。');
    }
  }

  function stop() {
    const current = session;
    session = null;
    if (speech) {
      speech = null;
      window.speechSynthesis.cancel();
    }
    current?.turn?.abort();
    current?.capture?.disconnect();
    current?.stream?.getTracks().forEach(track => track.stop());
    if (current?.context && current.context.state !== 'closed') void current.context.close().catch(() => {});
    chunks = [];
    setPhase('off');
  }

  function speak(text) {
    if (!session) return;
    const current = session;
    if (!text || !window.speechSynthesis) {
      if (text) onError('此浏览器没有语音朗读，回复已显示在对话中。');
      listen();
      return;
    }
    if (speech) {
      speech = null;
      speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    speech = utterance;
    utterance.lang = 'zh-CN';
    utterance.rate = .95;
    const chinese = speechSynthesis.getVoices().filter(item => /^zh/i.test(item.lang));
    utterance.voice = chinese.find(item => item.localService) || chinese[0] || null;
    setPhase('speaking');
    const done = () => {
      if (speech !== utterance) return;
      speech = null;
      if (session === current) listen();
    };
    utterance.onend = done;
    utterance.onerror = () => {
      if (speech !== utterance) return;
      onError('语音朗读不可用，回复已显示在对话中。');
      done();
    };
    speechSynthesis.speak(utterance);
  }

  function pauseForText() {
    if (phase !== 'listening') return false;
    setPhase('thinking');
    return true;
  }

  return { start, stop, speak, pauseForText, get active() { return Boolean(session); } };
}

async function wavData(chunks, sampleRate) {
  const input = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  const rate = 16000;
  const count = Math.floor(input.length * rate / sampleRate);
  const bytes = new DataView(new ArrayBuffer(44 + count * 2));
  function word(offset, value) {
    for (let i = 0; i < value.length; i++) bytes.setUint8(offset + i, value.charCodeAt(i));
  }
  word(0, 'RIFF');
  bytes.setUint32(4, 36 + count * 2, true);
  word(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  word(36, 'data');
  bytes.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const first = Math.floor(i * sampleRate / rate);
    const end = Math.max(first + 1, Math.floor((i + 1) * sampleRate / rate));
    let sum = 0;
    for (let j = first; j < end; j++) sum += input[j];
    bytes.setInt16(44 + 2 * i, Math.round(32767 * Math.max(-1, Math.min(1, sum / (end - first)))), true);
  }
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取录音，请再试一次。'));
    reader.readAsDataURL(new Blob([bytes], { type: 'audio/wav' }));
  });
}
