# Task Plan: QA前端输出流程跑通

## Goal
确认 HDMS 前端“管控问答助手”为什么看起来输出不了结果，并将从页面发起请求到 Next 代理再到 QA 后端 SSE 返回的整条链路实际跑通。

## Current Phase
Phase 4

## Phases
### Phase 1: 现状确认与根因调查
- [x] 核对前端 QA 请求入口、Next 代理路由和后端 QA 服务端口
- [x] 确认当前运行中的前端与各后端进程
- [x] 记录关键发现到 `findings.md`
- **Status:** complete

### Phase 2: 真实复现
- [x] 直接请求前端 `/qa/chat/stream` 复现问题
- [x] 直接请求 QA 后端 `/qa/chat/stream` 对比行为
- [x] 确认失败发生在前端代理配置而不是后端服务本身
- **Status:** complete

### Phase 3: 最小修复
- [x] 修正 external 模式前端默认 QA 代理端口
- [x] 重启前端并确认代理目标切换到真实 QA 服务
- **Status:** complete

### Phase 4: 验证与交付
- [x] 验证 `/assistant` 页面可访问
- [x] 验证前端 `/qa/chat/stream` 可以收到真实 SSE 事件
- [x] 汇报变更、验证结果与残余风险
- **Status:** complete

## Key Questions
1. 当前前端实际跑在哪个端口？
2. Next 代理把 QA 请求发到了哪个上游地址？
3. 实际在线的 QA 后端端口是多少？
4. 问题是在渲染层、代理层，还是后端 SSE 层？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 先不猜测渲染器问题，先跑真实 `/qa/chat/stream` 链路 | 这是最短的根因定位路径 |
| 优先修 `scripts/start-frontend.ps1` 的 external 模式默认 QA 端口 | 当前启动方式就是通过该脚本注入环境变量 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| external 模式默认 `HDMS_QA_BASE_URL=http://localhost:8022`，但 8022 无服务 | 1 | 改为指向实际在线的 QA 服务 `http://localhost:8032` |

## Notes
- 当前前端在 `8021`，审查系统在 `8023`，审批清单在 `8024`，数据处理在 `8125`，QA 服务在 `8032`。
- 这次问题的核心不是 markdown renderer，而是 external 模式启动参数配置错误。
