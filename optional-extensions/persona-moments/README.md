# 人格定时朋友圈 0.3.1（Windows 接入测试版）

这是 WeChatGirl 插件 API v2 插件。按聊天当前人设总结当天对话，在宿主每日计划中调用包内 Python 组件，操作当前微信的纯文字朋友圈。0.3.0 增加两条人工把关的发布通道：

- **管理员直发**：管理员在私聊里明确要求“发个朋友圈，就说……”，模型调用 `persona-moments__post` 立即填文并点击发表。
- **重大事件候选**：模型判断聊天中出现值得公开的事，只能调用 `persona-moments__propose` 提交候选；管理员在私聊看到候选后说“发”，才由 `persona-moments__approve` 真正发表。

所有发布都以管理员私聊为闸门。群聊、普通好友、群友发言和聊天里的指令都不能直接触发发表。

**当前状态：0.3.0 的发布组件沿用 0.2.1 已在真机验证的纯文字预览/发表链路，新增的管理员工具、候选存储和配置项已通过离线单元测试；尚未在真实微信里跑通“微信消息 → 模型调用工具 → 发表”的整条链路，也未验证服务器回执。**

## 安装

1. 解压完整接入包，双击“安装运行环境.cmd”。需已安装64位 Python 3.9+ 与 `py` 启动器，并能联网下载依赖。它只在本机 LocalAppData/WeChatAgentMoments/runtime 建虚拟环境，不改微信或宿主文件。安装时不启动微信自动化。
2. 打开 WeChatGirl → 能力 → 能力目录，导入 `persona-moments-0.3.1.zip`。升级时保持 id 不变、递增 version，确认更新后重新授权启用。
3. 在插件配置中，**只选择一个聊天作为日常素材来源**，授权清单全部权限，填写 `adminChatKey`（管理员私聊，如 `wechat:private:你的管理员微信ID`），保留 mode=preview。时间默认北京时间21:30。
4. workspaceRoot 通常留空，插件会从安装位置 `workspace/plugins/persona-moments/lib` 推导 workspace。不要把安装根目录 app 或 data 当作 workspace。自定义路径必须包含 config/wechatagent.json、state 和 scripts/wechat-account-check.mjs。
5. 默认Python路径是 `C:\Users\你的用户名\AppData\Local\WeChatAgentMoments\runtime\Scripts\python.exe`；自定义安装位置时设置 pythonExe 为绝对路径，不要填参数或命令行。
6. 确保后台、DSH、匹配微信均已启动，登录所选账号并完成同步。微信需简体中文、桌面解锁且可操作。只连接一个微信主窗口。
7. 双击完整包中的“测试预览.cmd”，输入控制台地址。源码默认 http://127.0.0.1:3210；桌面版可能使用动态端口，请填实际地址。工具通过 `/api/info` 获取当前本机控制台令牌，再调用已授权动作；不打印或保存令牌。选择一个聊天时自动采用其key。
8. 成功返回 `preview_ready` 时，正文已写入、校验一致，停在发表前。预览动作强制不发布，即使mode已改成publish。可由你检查并手动取消编辑框。

没有当天聊天时不会生成，也不会拿其他聊天填充。模型超时可能需要下次宿主重试。不要在测试期间同时操作微信鼠标键盘。

## 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| writeTime | 21:30 | 每日计划的北京时间。 |
| mode | preview | draft 只存草稿；preview 填好后暂停；publish 自动点击发表。 |
| workspaceRoot | 空 | 留空按安装位置推导。 |
| pythonExe | 空 | 留空用 LocalAppData 的 venv。 |
| adminChatKey | 空 | 管理员私聊 key。填写后只有该私聊能发布/确认；留空时任意私聊都可，**不推荐**。 |
| approvalMinutes | 120 | 候选有效期，过期自动失效。 |
| maxPostsPerDay | 1 | 每天最多发布条数（账号级，所有聊天与人设共享），1–3。 |
| autoPropose | true | 关闭后模型不能提交候选。 |

## 工具与流程

- `persona-moments__status`：只读，查看当天草稿、待确认候选和上次结果。
- `persona-moments__propose`：`{text, reason?}`，把候选写入 `state/persona-moments/pending-账号作用域.json`，返回候选 id。**不发布**。
- `persona-moments__approve`：`{id?}`，仅在管理员私聊可用；取最新或指定候选，填文后点击“发表”。
- `persona-moments__reject`：`{id?}`，仅在管理员私聊可用；丢弃候选。
- `persona-moments__post`：`{text}`，仅在管理员私聊可用；立即发表管理员给出的正文。

管理员私聊每次收到消息前，`before-context` 钩子会把未过期的候选写进上下文，所以模型能主动说“有一条待确认：……要发吗？”。候选超过 `approvalMinutes` 自动失效。

发布类工具受宿主单次工具 8 秒限制，组件内部预算 6.5 秒：超时会返回“结果未知，请核对”，而不是假装成功。

## 开启定时发布

先确保实机预览成功，再把 mode 改成 publish 并保存。宿主到点生成文案并自动发表，不需要额外创建系统定时任务。mode=draft只生成保存，mode=preview只填写后暂停，mode=publish会自动点击最终发表。

每个账号北京时间每天最多发布 `maxPostsPerDay` 条，所有聊天与人设共享。人设改变或重新启用不会绕过去重。默认只存20份日期/人设草稿。可在微信请求“查看朋友圈草稿和状态”，模型可调用 `persona-moments__status` 只读工具。

本机动作：preview强制预览；run-now按当前配置立即执行，publish模式下会发表。两者通过原程序已认证接口 `POST /api/plugins/persona-moments/actions/动作id`，正文 `{"key":"已授权聊天key","args":{}}`，只供本机使用。本包预览工具只调用preview，不调用run-now。生成与发布使用35秒动作预算，不放入8秒模型工具。

## 如何判断结果

- draft_only：仅保存草稿。
- preview_ready：正文校验成功并且发表按钮可用，未点击发表。
- failed_before_commit：没有完成最终授权；检查error。宿主每日计划可重试。
- submitted_unverified：已尝试点击发表，**不代表服务器确认发布成功**。本包暂不具备朋友圈回读核验能力。
- unknown / committing：最终操作结果不明，自动重试被阻止。
- blocked_existing_receipt：当天已达发布上限，不再点击。

发表尝试记录在 `workspace/state/persona-moments/账号作用域/YYYY-MM-DD.json`，含 `count`、正文哈希和操作时间，不存聊天、令牌或明文文案。失败状态仍会保留记录以防重发；请先到微信核对。正常使用不要删除当天记录来重试。文件较小，长期使用可手动归档旧日期记录。

## 接入与权限边界

适配核对上游提交5cdedddc60936c550ce5c02558eb025a5350f48e、API v2及4.1.10.27原生后端。通过原宿主 `verifyWeChatAccount` 核验活动账号、原生后端版本、数据库账号和微信PID，再只操作该PID的唯一主窗口。点击发表前再次检查宿主存储权限、人设、取消信号及实时账号。使用操作系统文件锁实现跨调用互斥，提交前持久记录。子程序受父调用超时与取消管理，插件不自行创建常驻定时器。

本插件除清单宿主权限外，还使用Node本机文件读取和子进程能力。**权限清单中没有官方朋友圈权限**，发布依靠本机组件，mode=publish是此包显式发布开关。只安装你信任的代码。本包读取 WeChatGirl 本机配置以复用既有账号检查，不外传密钥，也不修改宿主或微信DLL。

已有不同内容的编辑草稿会停止并保留。控件不可访问时停止，不使用盲目坐标点击最终发表。剪贴板粘贴回退仅用于已核验编辑框，恢复原文本；遇到非文本剪贴板会停止。窗口标题、控件、微信升级或UIA不可见均可能导致不兼容。当前不支持配图、可见范围修改、手机端发布、登录自动化、锁屏运行或可靠服务端回执。

停用插件会停止新任务；已进入最终点击阶段的操作无法撤回，请自行核对微信。首次真实发布和微信升级后均需检查结果。

## 开发与验证

`node --test tests/persona-moments.test.mjs`，`python -m unittest discover -s tests -p test_publisher.py`。以原项目 `node scripts/pack-plugin.mjs 插件目录 输出.zip`校验打包。状态逻辑与模拟驱动测试不代表真实微信测试通过。0.3.0 新增的候选存储、管理员闸门和配置默认可离线测试。

## 0.3.1 修复

运行模式在界面中明确标注是否发布。调度去重区分模式和执行时间，保存草稿不再阻塞后续发布；发布前失败按15分钟退避，已提交但结果不明不重发。00:00计划读取前一天、同一已授权聊天的素材；其他时间读取当天。每天最多条数正确传递到发布组件；同文案或未知提交结果均阻止重复发布。

当前机器首次启用自动发布从下一个原定时间点开始，不补发旧草稿。需要电脑、DSH、后台和已登录微信保持运行，桌面解锁；发布仍依赖微信界面，没有朋友圈服务器回读，提交结果会如实记录为待核对。
