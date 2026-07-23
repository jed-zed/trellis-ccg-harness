---
description: '管理 Git Worktree：在 ../.ccg/项目名/ 目录创建，支持 IDE 集成和内容迁移'
---

> External intelligence default: this Git-only workflow does not invoke Grok automatically. Use `/ccg:grok-intel` or `/ccg:grok-verify` explicitly when external evidence is actually required.

# Worktree - Git Worktree 管理

在结构化目录管理 Git worktree，支持智能默认和 IDE 集成。

## 使用方法

```bash
/worktree <add|list|remove|prune|migrate> [options]
```

## 子命令

| 命令 | 说明 |
|------|------|
| `add <path>` | 创建新 worktree |
| `list` | 列出所有 worktree |
| `remove <path>` | 删除指定 worktree |
| `prune` | 清理无效引用 |
| `migrate <target>` | 迁移内容到目标 worktree |

## 选项

| 选项 | 说明 |
|------|------|
| `-b <branch>` | 创建新分支 |
| `-o, --open` | 创建后用 IDE 打开 |
| `--from <source>` | 迁移源路径 |
| `--stash` | 迁移 stash 内容 |
| `--track` | 跟踪远程分支 |
| `--detach` | 分离 HEAD |
| `--lock` | 锁定 worktree |

---

## 目录结构

```
parent-directory/
├── your-project/           # 主项目
│   ├── .git/
│   └── src/
└── .ccg/                   # worktree 管理目录
    └── your-project/
        ├── feature-ui/     # 功能分支
        ├── hotfix/         # 修复分支
        └── debug/          # 调试 worktree
```

---

## 执行工作流

### Add - 创建 Worktree

`[模式：创建]`

1. 验证 Git 仓库
2. 计算路径：`../.ccg/项目名/<path>`
3. 创建 worktree
4. 自动复制环境文件（`.env` 等）
5. 可选：用 IDE 打开

### Migrate - 迁移内容

`[模式：迁移]`

1. 验证源有未提交内容
2. 确保目标干净
3. 显示即将迁移的改动
4. 安全迁移
5. 确认结果

---

## 示例

```bash
# 基本创建
/worktree add feature-ui

# 创建并用 IDE 打开
/worktree add feature-ui -o

# 创建指定分支
/worktree add hotfix -b fix/login -o

# 迁移未提交内容
/worktree migrate feature-ui --from main

# 迁移 stash 内容
/worktree migrate feature-ui --stash

# 管理操作
/worktree list
/worktree remove feature-ui
/worktree prune
```

## 输出示例

```
✅ Worktree created at ../.ccg/项目名/feature-ui
✅ 已复制 .env
✅ 已复制 .env.local
📋 已从 .gitignore 复制 2 个环境文件
🖥️ 是否在 IDE 中打开？[y/n]: y
🚀 正在用 VS Code 打开...
```

---

## 智能特性

1. **智能默认** – 未指定分支时使用路径名
2. **IDE 集成** – 自动检测 VS Code / Cursor / WebStorm
3. **环境文件** – 自动复制 `.gitignore` 中的 `.env` 文件
4. **路径安全** – 始终使用绝对路径防止嵌套问题
5. **分支保护** – 验证分支未被其他地方使用

## 注意事项

- Worktree 共享 `.git` 目录，节省磁盘空间
- 迁移仅限未提交改动，已提交内容用 `git cherry-pick`
- 支持 Windows、macOS、Linux
