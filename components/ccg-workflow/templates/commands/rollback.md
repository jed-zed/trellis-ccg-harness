---
description: '交互式 Git 回滚：安全回滚分支到历史版本，支持 reset/revert 模式'
---

> External intelligence default: this Git-only workflow does not invoke Grok automatically. Use `/ccg:grok-intel` or `/ccg:grok-verify` explicitly when external evidence is actually required.

# Rollback - 交互式 Git 回滚

安全地将分支回滚到指定历史版本，默认 dry-run 模式。

## 使用方法

```bash
/rollback [options]
```

## 选项

| 选项 | 说明 |
|------|------|
| `--branch <branch>` | 要回滚的分支 |
| `--target <rev>` | 目标版本（commit/tag/reflog） |
| `--mode reset\|revert` | 回滚模式 |
| `--depth <n>` | 列出最近 n 个版本（默认 20） |
| `--dry-run` | 只预览，不执行（**默认**） |
| `--yes` | 跳过确认直接执行 |

---

## 执行工作流

### 🔍 阶段 1：同步远端

`[模式：准备]`

```bash
git fetch --all --prune
```

### 📋 阶段 2：选择分支

`[模式：选择]`

1. 列出本地 + 远端分支
2. 过滤受保护分支
3. 用户选择或使用 `--branch` 参数

### 📜 阶段 3：选择版本

`[模式：选择]`

1. 显示最近 N 个版本（`git log --oneline`）
2. 显示相关 tags（`git tag --merged`）
3. 用户选择或使用 `--target` 参数

### ⚙️ 阶段 4：选择模式

`[模式：决策]`

| 模式 | 说明 | 推送方式 |
|------|------|----------|
| `reset` | 硬回滚，改变历史 | `--force-with-lease` |
| `revert` | 生成反向提交，保留历史 | 普通 push |

### ⛔ 阶段 5：最终确认

`[模式：确认]`

显示即将执行的命令，等待用户确认（除非 `--yes`）。

### ✅ 阶段 6：执行回滚

`[模式：执行]`

**reset 模式**：
```bash
git switch <branch>
git reset --hard <target>
```

**revert 模式**：
```bash
git switch <branch>
git revert --no-edit <target>..HEAD
```

---

## 安全护栏

1. **备份**：执行前自动记录当前 HEAD 到 reflog
2. **保护分支**：`main`/`master`/`production` 需额外确认
3. **dry-run 默认**：防止误操作
4. **禁止 --force**：如需强推，手动执行

---

## 示例

```bash
# 全交互模式（dry-run）
/rollback

# 指定分支
/rollback --branch dev

# 完整指定，一键执行
/rollback --branch main --target v1.2.0 --mode reset --yes

# 生成反向提交
/rollback --branch release/v2.1 --target v2.0.5 --mode revert
```

## 注意事项

- **reset vs revert**：reset 改变历史，需强推；revert 更安全
- **LFS/子模块**：回滚前确保状态一致
- **CI 触发**：回滚后可能自动触发流水线
