---
name: selective-upstream-sync
description: Use when maintaining a forked repository and need to review upstream changes, then selectively implement desired features on an independent branch
---

# 选择性上游同步

## Overview

在独立分支上审查上游仓库更新，按需选择性实现有价值的功能，丢弃不需要的改动。

**核心原则**：不盲目合并上游所有内容，而是逐个审查、决策、实现。

## When to Use

- fork 了别人的项目，在自己的分支上做定制开发
- 上游有新 commit，想了解改了什么
- 需要挑选有价值的功能实现，跳过不需要的
- 想保持 main 分支和上游同步，同时在个人分支上独立开发

## 工作流程

### 1. 对比差异

```bash
# 获取上游最新代码
git fetch upstream

# 查看落后了哪些 commit
git log --oneline main..upstream/main

# 查看具体文件改动
git diff --stat main..upstream/main
```

### 2. 审查功能

对每个 commit/功能：
- 阅读 commit message 和代码改动
- 理解功能用途和使用场景
- 判断是否对自己有价值

### 3. 决策并实现

**需要的功能**：
1. 在个人分支上小步实现
2. 每实现一块后验证
3. 确认 OK 后继续下一个

**不需要的功能**：
- 跳过，不合并

### 4. 同步 main

```bash
# 切到 main 分支
git checkout main

# fast-forward 到上游
git merge upstream/main --ff-only

# 推送到自己的 origin
git push origin main

# 切回个人分支
git checkout personal
```

## 决策矩阵

| 场景 | 决策 |
|------|------|
| 功能有用，代码可复用 | 直接 cherry-pick 或手动实现 |
| 功能有用，但需要改造 | 手动实现，参考思路 |
| 功能没用 | 跳过 |
| 纯样式/文档更新 | 评估后决定是否同步 |

## 注意事项

- 个人分支的改动不要推到 upstream
- main 分支保持和 upstream 同步
- 实现功能时保持小步提交，方便回退
- 测试功能是否真正有用，没用就移除
