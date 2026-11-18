# 小小造物家 · Little Maker

把一张手绘画变成可以转动的 3D 小伙伴，和创作伙伴“小芽”一起给作品讲故事。

面向儿童创意表达的本地网页原型，为 Aholo 全球 3D AI 黑客松开发。Lux3D 负责生成最终三维资产，网页集成文字聊天、语音交流、生成进度与作品预览。

## 功能

- 上传 PNG、JPG、WebP 画作，填写名称和想保留的细节。
- 多模态模型理解原画，图像模型生成斜前上方、右侧和背面参考，Lux3D 生成 GLB。
- 生成期间回到聊天，可以文字交流或开启麦克风连续对话。
- 保存一句作品故事，也可以选择本轮聊天中的一句话存入作品。
- 查看、旋转、缩放、下载 GLB，浏览已有作品并收藏。
- SQLite 保存单一对话，早期消息可分页查看，模型上下文自动裁剪。
- 适配桌面、窄窗口与矮窗口的森林绘本界面。

## 本地运行

需要 Node.js 24 和 npm，语音体验建议使用支持麦克风与中文朗读的 Chrome 或 Edge。

~~~bash
git clone https://github.com/Tracy-Duan/little-maker.git
cd little-maker
npm ci
~~~

把 `.env.example` 复制为 `.env.local`，填写三个服务的配置。Windows PowerShell 可运行

~~~powershell
Copy-Item .env.example .env.local
~~~

~~~bash
npm run dev
~~~

打开 http://127.0.0.1:5173 。后端默认监听 http://127.0.0.1:3001 。修改配置后重新启动。Windows 也可以双击 `start-demo.cmd`。

没有 API Key 时可以查看界面与内置绘画示例，聊天和实际生成需要配置对应服务。

## 模型配置

| 配置 | 用途 |
| --- | --- |
| LLM_API_KEY / LLM_BASE_URL / LLM_MODEL | OpenAI 兼容聊天接口，用于原画理解、文字聊天和语音输入 |
| IMAGE_API_KEY / IMAGE_BASE_URL / IMAGE_MODEL | 千问 multimodal-generation 图像编辑接口，接收原画和文字 |
| AHOLO_API_KEY / AHOLO_BASE_URL | Aholo Lux3D 的访问配置 |
| LUX3D_MODEL | 默认 G1，需使用账号实际支持的版本 |

模板中的模型名称来自此项目的集成配置。可用模型与访问区域需按服务商账号核对。语音要求 LLM 支持 input_audio；仅支持文本的兼容接口无法完成语音输入。回复朗读使用浏览器的 speechSynthesis，可用声音取决于浏览器和操作系统。

服务文档可查阅 [阿里云百炼](https://help.aliyun.com/zh/model-studio/) 和 [Aholo API](https://labs.aholo.cn/api-docs/)。

## 生成流程

原画与补充描述 → 多模态理解 → 斜视参考 → 右侧与背面参考 → Lux3D 异步建模 → 保存 GLB → Three.js 展示。

第一张参考采用斜前上方视角，帮助表达物体厚度。侧面与背面由同一张参考推导。中间描述与图片地址在服务端内存中流转。图像服务及 Lux3D 会接收对应输入，使用前请了解服务商的数据处理条款。

生成会产生服务商费用。本地实例同时处理一个任务，每 24 小时最多创建 20 次。进度由任务阶段与时间估算，实际完成后才显示 100%。生成失败可重新制作，查询中断可重查任务。重启后可继续查询已提交 Lux3D 的任务。

当前多视角一致性仍依赖生成模型，可能出现形状偏差或扁平结果。下载的 GLB 需要进一步检查和修复后评估打印可行性。

## 数据与隐私

密钥仅由 Node 后端读取。配置文件请保存在被 Git 忽略的 `.env.local` 中，避免使用 VITE_ 前缀存储密钥。

聊天转写、回复、作品故事、任务记录和生成模型保存在本地 `.server-data/`。语音原始数据用于本轮请求，应用不把录音写入聊天数据库。收藏标记保存在浏览器 localStorage；移除收藏会保留作品文件。

仓库忽略本地环境配置、数据库、任务目录、录屏素材、参赛报告、演示模型及辅助脚本。每次提交前仍应检查 `git diff --cached`，确认新加入的文件内容适合公开。

当前服务绑定本机地址，共用单一会话及作品空间。公网部署需要补充身份验证、用户数据隔离、费用控制、内容治理与数据管理。当前 Demo 用于本地体验。

## 项目结构

~~~text
index.html / style.css    页面与响应式样式
src.js                   聊天、制作、作品及任务交互
voice.js                 麦克风采集、停顿检测与浏览器朗读
viewer.js                Three.js GLB 展示
server/index.mjs         HTTP 接口、任务调度与本地存储
server/providers.mjs     模型服务适配
server/conversation.mjs  SQLite 会话与上下文裁剪
public/assets/           界面插画
public/draco/            Draco 模型解码器
tests/                   服务与会话测试
~~~

个人生成结果保存在本机。若需自备公开精选案例，可在 `public/cases/index.json` 放置数组，例如 `[{"id":"rabbit","title":"小兔","story":"它喜欢星星。"}]`，并放置对应 `rabbit.png` 与 `rabbit.glb`。id 使用小写字母与连字符。配置后首页会出现案例入口。该目录默认被 Git 忽略，发布案例前请审查内容和授权。

## 验证

~~~bash
npm test
npm run build
~~~

测试使用合成数据和模拟模型响应，不需要密钥，也不产生模型费用。构建输出到 `dist/`，真实生成仍需要 Node 后端。Three.js 构建可能显示体积提示。

## 许可证

项目原创代码采用 [MIT License](LICENSE)。界面插画由生成式 AI 辅助制作。第三方解码器遵循其原有许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。服务端模型及模型服务遵循各供应商条款。

### 已知依赖公告

发布检查中 npm audit 报告 picomatch 的正则拒绝服务问题，并连带标记 fdir、tinyglobby 和 Vite，共四个 high 项。运行 npm audit fix 后仍有该报告；检查时 npm 返回的 picomatch 最新版本为 4.0.7。当前版本用于本机运行，后续升级依赖时需重新核验公告和修复状态。公告 https://github.com/advisories/GHSA-fc5q-39xc-vjpf 。
