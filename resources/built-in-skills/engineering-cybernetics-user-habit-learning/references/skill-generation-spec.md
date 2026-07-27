# Skill 生成规范

## 生成目标

把稳定证据转化为另一个 AI 可以独立执行、审查、评估和维护的 Skill。生成的是候选方案；没有实际写入和目标应用扫描证据时，不声称已经安装。

## 生成前决策

### 确认目标平台

- Format Flow 当前兼容格式使用 `generate by: engineering-cybernetics` 和 `agent/openai.yaml`。
- 标准 Codex Skill 只使用其校验器允许的 frontmatter，并通常使用 `agents/openai.yaml`。
- 不假定一个未经测试的目录或字段能在所有平台工作。需要跨平台时，生成目标平台变体或先验证兼容解析。
- 在证据清单中记录目标平台和已验证格式。

### 确认生成粒度

保持一个 Skill，条件是目标、触发方式、生命周期和验证方法高度一致。出现以下任一情况时拆分：

- 子流程能被独立调用并有独立输入输出。
- 用户偏好与易变化的项目架构混在一起。
- 单个 `SKILL.md` 接近 500 行或引用导航变得困难。
- 某部分需要不同权限、模型强度或发布节奏。

优先把用户偏好留在主文件，把产品和架构事实放入 references；不要把整个项目历史写成一个 Skill。

## 命名与分类

- 目录名和 `name` 只使用小写字母、数字和连字符，长度不超过 64 个字符。
- 名称描述功能，不使用 `my-personal-skill` 等泛化名称。
- `description` 使用中文，同时说明功能和触发场景。
- Format Flow 生成来源固定写为：

```yaml
generate by: engineering-cybernetics
```

## 目录结构

```text
skill-name/
|-- SKILL.md
|-- agent/
|   `-- openai.yaml
|-- scripts/
|-- references/
|-- assets/
`-- extras/
    `-- generation-manifest.json
```

- `SKILL.md` 必须存在。
- Format Flow 目标必须有 `agent/openai.yaml`。
- 证据驱动生成的 Skill 必须有 `extras/generation-manifest.json`。
- 确定性、重复性的操作放入 `scripts`，并说明输入、输出和失败退出码。
- 详细知识、产品规则、架构事实和长示例放入 `references`。
- 最终输出直接使用的真实模板或图标放入 `assets`；只写图标建议不能替代实际资产。
- 无实际内容的可选目录保持空，不创建 `none.md`。

## SKILL.md 内容

主文件至少包含：

1. 目标和输入边界。
2. 知识类型或 references 路由。
3. 可执行闭环工作流。
4. 反馈纠偏和冲突处理。
5. 禁止项和权限边界。
6. 质量门槛和退出条件。
7. 架构或产品变化后的复审触发。

使用祈使式和可验证动作，不写空泛人格描述。主文件不重复 references 的详细内容。

Format Flow frontmatter 示例：

```yaml
---
name: example-skill
description: 用中文说明功能和触发场景。
generate by: engineering-cybernetics
---
```

## agent/openai.yaml

```yaml
model: gpt-5
reasoning:
  effort: medium
```

综合长对话、冲突证据或高风险规则时使用 `high`。不得写入密钥或账号。目标平台升级模型配置后重新验证，不永久假定某个模型名称有效。

## generation-manifest.json

至少包含：

```json
{
  "schema_version": 1,
  "skill_name": "example-skill",
  "generated_by": "engineering-cybernetics",
  "target_platform": "format-flow",
  "status": "candidate",
  "source_scope": "脱敏的样本范围",
  "rules": [],
  "discarded_signals": [],
  "conflicts": [],
  "evaluation": {}
}
```

每条活动规则使用 `evidence-and-lifecycle.md` 的记录字段。不得保存原始对话、账号、路径和一次性环境数据。

## 控制模型要求

复杂项目 Skill 应包含控制状态表或对应 reference，至少说明：

- 目标状态、状态变量、观测量和控制动作。
- 扰动、噪声、时滞、稳定条件和独立兜底。
- 中间信号与最终验收信号的区别。
- 哪些事实会随架构变化而失效。

## 内容选择规则

- 只把稳定偏好写为 `preference`。
- 把产品行为写为 `product-rule`，不要伪装成个人偏好。
- 把源码事实写为 `architecture` 并设置复审触发。
- 把数据、权限和发布边界写为 `safety-policy`。
- 把证据不足或相互冲突的内容留在 `hypothesis` 或清单中，不写成活动规则。
- 为每条负反馈规则提供替代动作和验证方法。
- 将一次性版本、路径、账号、余额错误和网络故障过滤掉。

## 脚本与资产

- 对反复执行且容易出错的检查提供确定性脚本。
- 实际运行脚本的成功与失败路径。
- 脚本默认只读；需要修改用户数据时必须明确说明并取得授权。
- 提供与功能语义相关的真实图标或模板，检查格式和引用路径存在。

## 输出协议

按以下顺序输出：

1. Skill 名称和用途。
2. 系统控制表。
3. 稳定证据、反证和被过滤信号。
4. Skill 拆分或合并决定。
5. 完整目录树和逐文件内容。
6. 证据清单与生命周期状态。
7. 静态、脚本和前向评估结果。
8. 目标平台兼容性和待确认规则。

## 验收检查

- frontmatter 能被目标平台解析，`name` 与目录名一致。
- `description` 不依赖正文即可正确触发。
- 主文件不超过 500 行，详细知识已进入 references。
- 五类知识没有混用，活动规则都有证据和复审条件。
- 控制模型区分中间信号和最终验收。
- `generation-manifest.json` 完整且已脱敏。
- 脚本实际运行通过，并有明确失败退出码。
- 至少三个代表性场景完成前向评估，或明确标为未完成。
- 没有密钥、账号、绝对路径和无关原始对话。
- Format Flow 目标的 `generate by: engineering-cybernetics` 拼写完全一致。
