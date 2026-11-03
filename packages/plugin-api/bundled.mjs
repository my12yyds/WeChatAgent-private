// Only these reviewed first-party packages belong in source/installer releases.
export const BUNDLED_PLUGINS = Object.freeze([
  Object.freeze({id: 'chat-notes', name: '聊天小便签示例', version: '1.0.0', source: 'examples/plugins/chat-notes', files:['README.md','index.mjs','plugin.json']}),
  Object.freeze({id: 'admin-dsh', name: '管理员 DSH 助手', version: '1.1.0', source: 'optional-extensions/admin-dsh', zip: 'optional-extensions/packages/admin-dsh-1.1.0.zip'}),
  Object.freeze({id: 'bilibili-public', name: '哔哩哔哩', version: '1.0.0', source: 'optional-extensions/bilibili-public', zip: 'optional-extensions/packages/bilibili-public-1.0.0.zip'}),
  Object.freeze({id: 'fish-notebook', name: '鱼的记事本', version: '1.0.0', source: 'optional-extensions/fish-notebook', zip: 'optional-extensions/packages/fish-notebook-1.0.0.zip', files:['README.md','index.mjs','lib/notebook.mjs','plugin.json']}),
  Object.freeze({id: 'netease-music', name: '网易云音乐', version: '1.1.0', source: 'optional-extensions/netease-music', zip: 'optional-extensions/packages/netease-music-1.1.0.zip'}),
  Object.freeze({id: 'people-memory', name: '跨聊天人物记忆', version: '1.1.0', source: 'optional-extensions/people-memory', zip: 'optional-extensions/packages/people-memory-1.1.0.zip'}),
  Object.freeze({id: 'persona-moments', name: '人格定时朋友圈', version: '0.3.1', source: 'optional-extensions/persona-moments', zip: 'optional-extensions/packages/persona-moments-0.3.1.zip'}),
  Object.freeze({id: 'persona-studio', name: 'AI 人格工作室', version: '1.1.0', source: 'optional-extensions/persona-studio', zip: 'optional-extensions/packages/persona-studio-1.1.0.zip'}),
  Object.freeze({id: 'speech-recognition', name: '微信语音识别', version: '1.2.0', source: 'optional-extensions/speech-recognition', zip: 'optional-extensions/packages/speech-recognition-1.2.0.zip', files:['README.md','index.mjs','lib/recognize.mjs','lib/diagnostics.mjs','plugin.json','assets/config-test.wav']}),
  Object.freeze({id: 'voice-studio', name: '语音工作室', version: '1.3.0', source: 'optional-extensions/voice-studio', zip: 'optional-extensions/packages/voice-studio-1.3.0.zip'}),
]);
