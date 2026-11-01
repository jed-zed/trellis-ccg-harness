# CCG Fork Context

This context defines behavioral ownership between upstream CCG and the personal fork so that extensions do not silently redefine inherited behavior.

## Language

**Upstream-owned behavior**:
Behavior that already exists in the selected upstream CCG revision. The personal fork follows its defaults and semantics unless Boss explicitly approves a deviation.
_Avoid_: 原版差不多、兼容行为、自行改进

**Fork-only extension**:
Behavior with no upstream counterpart. It may add a new explicit entrypoint, but it must not alter upstream-owned defaults implicitly.
_Avoid_: 上游修复、默认增强

**Extension preservation**:
A parity change keeps fork-only entrypoints, routing, state, validation, output, and release behavior intact unless Boss explicitly scopes a separate feature change.
_Avoid_: 借同步上游删除功能、顺手重构新增能力

**Provider permission inheritance**:
Every invocation of a Provider implemented by upstream CCG inherits that Provider's upstream permission defaults, including invocations started by fork-only extensions.
_Avoid_: 按入口另设权限、审查专用权限、情报专用权限

**Claude expert eligibility**:
Claude is a valid selectable Provider for frontend and backend expert roles as well as the product-manager role. Eligibility alone does not select or invoke Claude.
_Avoid_: Claude 仅限 Product Manager、普通 Claude 委派一律禁用

**Explicit Claude selection**:
Claude is used for frontend or backend work only after an explicit role-routing or task-level selection. It is not a default Provider, automatic fallback, or search Provider.
_Avoid_: Claude 自动接管、失败后切换 Claude、Claude 搜索角色

**GPT Pro permission exception**:
GPT Pro remains a read-only sidebar evidence channel because upstream CCG has no corresponding Provider permission contract for it.
_Avoid_: 将普通 Provider 的自动批准权限套给 GPT Pro

**Native Pi authority**:
Pi uses its native default capabilities and trusted project resources. CCG preserves transport and session behavior without imposing a separate read-only tool profile.
_Avoid_: Pi 只读白名单、借其他 Provider 参数模拟 Pi

**Permission enforcement**:
Permission-only prompt instructions, preflight denials, forced environment restrictions, and result rejection based only on tool use are part of Provider permissions and follow the same upstream or native authority as launch arguments. Upstream-owned role prompts remain unchanged.
_Avoid_: 表面开放工具但事后拒收结果

**Upstream parity**:
The state in which upstream-owned behavior matches the selected upstream revision in runtime semantics, permissions, documentation, and tests.
_Avoid_: 大致一致、功能等价

**Upstream baseline**:
An exact commit resolved from the official `fengshao1227/ccg-workflow` `main` branch. The personal fork, Harness snapshot, installed CLI, and plugin cache are never called the upstream baseline.
_Avoid_: 把个人分支 main 当原版、实施期间追逐移动分支

**Live Provider smoke gate**:
A planned Grok, Pi, or Claude live smoke requires fresh explicit authorization after offline verification. Listing it in a plan is not permission to invoke a Provider.
_Avoid_: 把计划批准当调用授权、自动执行真实冒烟

**Delivery authorization separation**:
The plan covers source changes, offline verification, versioning, commit and CI, wrapper and plugin publication, formal Harness update, installation, and final verification. Planning the chain does not authorize any commit, push, publication, Harness synchronization, installation, or live Provider call; each external or persistent stage requires fresh explicit approval.
_Avoid_: 把完整计划当批量执行授权、一次批准覆盖后续发布和安装

**Live smoke outcome**:
A live smoke failure blocks completion only when evidence attributes it to the fork's code, launch arguments, or permission restoration. Authentication, network, quota, and temporary Provider availability failures are recorded as environmental and inconclusive; they neither prove a code regression nor count as a verified live call.
_Avoid_: 把外部服务故障算成代码失败、把未完成冒烟写成已验证
