# 随源码分发的第一方插件包

此目录由 `node scripts/pack-bundled-plugins.mjs` 生成，收录 WeChatGirl 第一方插件的可导入 ZIP。插件源代码分别位于本目录的同级文件夹中；唯一版本与展示名称清单是 `packages/plugin-api/bundled.mjs`。控制台插件下载列表由该清单自动生成，避免界面版本与实际包版本分离。

| ID | 插件 | 版本 |
| --- | --- | --- |
| `admin-dsh` | 管理员 DSH 助手 | 1.1.0 |
| `bilibili-public` | 哔哩哔哩 | 1.0.0 |
| `fish-notebook` | 鱼的记事本 | 1.0.0 |
| `netease-music` | 网易云音乐 | 1.1.0 |
| `people-memory` | 跨聊天人物记忆 | 1.1.0 |
| `persona-moments` | 人格定时朋友圈 | 0.3.1 |
| `persona-studio` | AI 人格工作室 | 1.1.0 |
| `speech-recognition` | 微信语音识别 | 1.2.0 |
| `voice-studio` | 语音工作室 | 1.3.0 |

重新打包后会校验 ZIP 可读性并生成 SHA-256 文件。ZIP 只包含插件源码和明确登记的文件，不带账号配置、记忆、Cookie 或本机运行数据。导入后仍默认关闭，用户需自行配置权限、聊天范围并启用。插件宿主能力及版本限制见 `../../docs/PLUGIN_HOST_AUDIT.md` 与各插件 README。
