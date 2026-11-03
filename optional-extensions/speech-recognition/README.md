# 微信语音识别 1.3.0

基于 [sourcepro5/WeChatAgent 的语音识别插件](https://github.com/sourcepro5/WeChatAgent/tree/38c1060ce500a294d69a4a2f9e07ca1b63a08b06/optional-extensions/speech-recognition)适配 WeChatGirl，保留上游 MIT 通知；来源与修改范围见 UPSTREAM.json。

好友或群聊收到语音后，由宿主读取对应消息音频，调用你配置的语音 API，再把转写文字交给当前聊天模型回复。不会切换聊天模型、人格或发送方式。

## 安装与配置

1. 加载本次配套宿主修复，保存编辑后完整重开 DSH 与 WeChatGirl 后台。单独导入 ZIP 不能补齐旧宿主缺失的接收接口。
2. 在“能力 → 能力目录”导入 speech-recognition-1.3.0.zip，打开“配置”。
3. 选择协议，填写服务地址、API Key 和真实模型 ID。地址、模型和密钥均默认留空；没有内置识别服务商。
4. 点击“读取模型”后选择模型，再点击“检测配置”。读取目录不上传音频；检测仅上传随包的合成测试短句，会使用服务额度。
5. 授予“读取当前微信语音”，选择允许的好友或群聊，启用并保存。“插件与聊天”可继续调整范围。

新版要求宿主能力 voice-input-route-v1，旧版只声明 voice-input-v1 不视为链路已经可用。配置和检测可在插件关闭时完成；测试成功不会自动启用或扩大聊天权限。

## 支持的接口

| 协议 | 请求方式 |
| --- | --- |
| 语音转写 API | 基础地址或完整 /audio/transcriptions，multipart 文件上传 |
| Chat 音频（Base64） | /chat/completions 的 input_audio |
| Chat 音频（Data URL） | 服务商要求的 WAV Data URL 形式 |
| 自定义请求 | 完整 POST 地址，自定义字段、鉴权、JSON 模板及结果路径 |
| Anthropic Messages | 仅用于模型发现；标准消息协议不能直接转写语音 |

保留网关路径和版本前缀，不尝试其他域名或协议重传。模型列表支持常见数组和别名映射；文本模型、实时 WebSocket 模型会提示限制，列表可见不代表识别成功。没有模型列表接口时可手动输入 ID。

## 音频、权限与隐私

默认由宿主内置 SILK 组件转为 WAV，无需下载识别模型或安装额外 pip 包。接口确实支持原始 SILK 时才选择 silk。默认 API 超时 20 秒，可配置 1–25 秒；单条最多 60 秒、2 MiB，转写最多 4000 字符。

只读取当前动作绑定、当前账号、当前已授权聊天的真实语音引用；拒绝文件路径、其他聊天和任意音频网址。账号切换、撤权、取消或设置变化会阻止过期结果继续使用。未配置接口或未授权不会上传。

音频发送至你配置的 API，费用及数据处理取决于服务商。密钥和响应中的敏感错误不会进入聊天或前端诊断。只缓存本进程中的有限转写结果，不扫描或上传历史语音。

## 顺序与失败处理

同一聊天保序，全局最多两条转写并发，其他语音有界排队；失败后不自动换协议或重复上传。识别失败会保留“语音已收到、但转写失败”的占位，后续文字继续处理，不编造语音内容。助手模式继续检查真实管理员身份，不因转写获得工具权限。

配置页分别显示转换组件、合成短句检测与最近实际语音状态；较新的真实失败不能被旧检测成功掩盖。修改接口、模型或密钥后需重新检测。

## 开发与检查

从项目根目录运行：

```powershell
node scripts/pack-bundled-plugins.mjs
node --test scripts/test-speech-recognition.mjs scripts/test-speech-diagnostics.mjs scripts/test-speech-protocol.mjs
```

语音读取与编解码测试还需设置 WECHATAGENT_TEST_PYTHON、VOICE_TEST_PYTHON 为发行版自带的 Python 路径，再运行 scripts/test-voice-input.mjs 和 scripts/test-voice-codec.mjs。测试使用合成音频、虚构账号和本机模拟接口，不自动给真实聊天发消息。

完整宿主说明见 [微信语音转写](../../docs/VOICE_INPUT.md)。
