import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWorkflow, defaultStore, nodeFromSkill } from '@shared/domain'
import type { SkillItem } from '@shared/types'
import { createProjectFlowState, recordDelivery, submitReview } from '@shared/workflow-v3'
import WorkflowStudio, { buildNodePayload, extractSkillOutputOutline, HistoricalNodeView, ProgressSummary, ProjectHistoryModal, projectNodeNavigationRole, removeUnusedWorkflow, ReviewNodeEditor, uniqueWorkflowTitle, WizardModal, WorkflowTemplateExporter, WorkflowTemplateImporter, type WorkflowLibraryUi } from './WorkflowStudio'
import { PREDEFINED_WORKFLOW_BLUEPRINTS } from '@shared/workflow-import-templates'

const sharedLibraryUi: WorkflowLibraryUi = {
  ResourceGroupManager: ({ title, groups }) => createElement(
    'aside',
    { 'data-shared-component': 'resource-group-manager' },
    createElement('h2', null, title),
    ...groups.map((group) => createElement('span', { key: group.id }, group.name))
  ),
  PanelHeader: ({ title, detail }) => createElement(
    'header',
    { 'data-shared-component': 'panel-header' },
    createElement('h2', null, title),
    createElement('p', null, detail)
  ),
  SearchBox: ({ query, placeholder }) => createElement(
    'label',
    { 'data-shared-component': 'search-box' },
    '搜索',
    createElement('input', { value: query, placeholder, readOnly: true })
  )
}

describe('workflow overview presentation', () => {
  it('starts without built-in workflows and offers one unified template entry', () => {
    const markup = renderToStaticMarkup(createElement(WorkflowStudio, {
      store: defaultStore(),
      skills: [],
      paths: null,
      commit: async () => undefined,
      setNotice: () => undefined,
      refreshSkills: async () => undefined,
      libraryUi: sharedLibraryUi
    }))

    expect(markup).toContain('当前没有工作流')
    expect(markup.match(/>导入模板</g)).toHaveLength(1)
    expect(markup).not.toContain('模板不预存研究类型或 Skill 名称')
    expect(markup).not.toContain('导入原始流程包模板')
    expect(markup).not.toContain('导入 JSON 模板')
    expect(markup).not.toContain('恢复 8 个内置模板')
  })

  it('previews predefined blueprint resolution and keeps import provenance out of the UI', () => {
    const blueprint = PREDEFINED_WORKFLOW_BLUEPRINTS[0]
    const skills = ['example-controller', 'example-writer', 'example-exporter'].map<SkillItem>((name, index) => ({
      id: `skill:${name}`,
      name,
      title: name,
      summary: '',
      tags: [],
      variables: [],
      favorite: false,
      path: `D:\\skills\\${String(index + 1).padStart(2, '0')}-${name}\\SKILL.md`,
      source: 'custom',
      contentPreview: '',
      contentFingerprint: 'a'.repeat(64),
      updatedAt: '2026-08-12T00:00:00.000Z'
    }))
    const markup = renderToStaticMarkup(createElement(WorkflowTemplateImporter, {
      blueprints: [blueprint],
      sourceLabel: '通用中间模板',
      preparedSkills: skills,
      packageName: '示例工作流包',
      packagePath: 'C:\\Users\\tester\\.codex\\skills\\workflow-package',
      metadataPath: 'D:\\metadata\\workflow-package.json',
      selectedKeys: [blueprint.templateKey],
      onSelectedKeys: () => undefined,
      selectedSkillIds: skills.map((skill) => skill.id),
      onSelectedSkillIds: () => undefined,
      onBlueprints: () => undefined,
      onFile: () => undefined,
      onPrepareSkills: async () => undefined,
      onCancel: () => undefined,
      onGenerate: () => undefined
    }))

    expect(markup).toContain('已识别')
    expect(markup).toContain('工作流名称')
    expect(markup).toContain('示例工作流包')
    expect(markup).toContain('托管 Skill 包')
    expect(markup).toContain('.codex')
    expect(markup).toContain('JSON 元数据')
    expect(markup).toContain('workflow-package.json')
    expect(markup).toContain('Skill 名称与目录编号均有效')
    expect(markup).toContain('01-example-controller')
    expect(markup).toContain('手动创建中间模板')
    expect(markup).toContain('>选择模板文件</button>')
    expect(markup).not.toContain('导出通用中间模板')
    expect(markup).toContain('预览')
    expect(markup).toContain('使用本次勾选的 Skill')
    expect(markup).toContain('生成的是新工作流，不修改已有工作流或项目')
    expect(markup).not.toContain('选择全部可生成模板')
    expect(markup).not.toContain('导入的工作流')
  })

  it('exports a selected workflow from the library-level template dialog', () => {
    const workflow = createWorkflow({ title: '可导出工作流' })
    const markup = renderToStaticMarkup(createElement(WorkflowTemplateExporter, {
      workflows: [workflow],
      blueprints: [...PREDEFINED_WORKFLOW_BLUEPRINTS],
      currentWorkflowId: workflow.id,
      onCancel: () => undefined,
      onExportWorkflow: () => undefined,
      onExportBlueprints: () => undefined
    }))
    expect(markup).toContain('导出模板')
    expect(markup).toContain('工作流 JSON')
    expect(markup).toContain('中间模板 JSON')
    expect(markup).toContain('可导出工作流')
    expect(markup).toContain('导出所选模板')
    expect(markup).not.toContain(workflow.templateVersion)
  })

  it('assigns deterministic copy titles while keeping generated workflows independent', () => {
    const titles = new Set(['原创研究论文｜实验研究', '原创研究论文｜实验研究 (2)'])
    expect(uniqueWorkflowTitle('原创研究论文｜实验研究', titles)).toBe('原创研究论文｜实验研究 (3)')
    expect(uniqueWorkflowTitle('SCI 综述从 0 到 1 可投稿', titles)).toBe('SCI 综述从 0 到 1 可投稿')
  })

  it('does not render internal lifecycle or applicability metadata as card information', () => {
    const base = createWorkflow()
    const workflow = createWorkflow({
      id: 'workflow-internal-fields',
      templateKey: 'workflow-internal-fields',
      templateVersion: '1.2.3-draft.1',
      status: 'draft',
      title: '内部字段展示测试',
      description: '只展示用户维护工作流所需的信息。',
      applicability: {
        ...base.applicability,
        riskLevel: 'medium',
        maturity: 'stable'
      }
    })
    const store = {
      ...defaultStore(),
      workflows: [workflow],
      projectFlowStates: []
    }

    const markup = renderToStaticMarkup(createElement(WorkflowStudio, {
      store,
      skills: [],
      paths: null,
      commit: async () => undefined,
      setNotice: () => undefined,
      refreshSkills: async () => undefined,
      libraryUi: sharedLibraryUi
    }))

    expect(markup).toContain('内部字段展示测试')
    expect(markup).toContain('data-shared-component="resource-group-manager"')
    expect(markup).toContain('data-shared-component="panel-header"')
    expect(markup).toContain('data-shared-component="search-box"')
    expect(markup).toContain('panel library-layout workflow-library')
    expect(markup).toContain('resource-card workflow-info-card')
    expect(markup).not.toContain('workflow-card-group-select')
    expect(markup).toContain('删除工作流')
    expect(markup).not.toContain('workflow-group-sidebar')
    expect(markup).not.toContain('workflow-search-field')
    expect(markup).not.toContain('workflow-family')
    expect(markup).not.toContain('workflow-card-version')
    expect(markup).not.toContain('Workflow v3')
    expect(markup).not.toContain('已发布')
    expect(markup).not.toContain('已归档')
    expect(markup).not.toContain('草稿')
    expect(markup).not.toContain('draft')
    expect(markup).not.toContain('风险')
    expect(markup).not.toContain('成熟度')
    expect(markup).not.toContain('medium')
    expect(markup).not.toContain('stable')
    expect(markup).not.toMatch(/\d+\/\d+\s*已完成/)
  })

  it('deletes only the selected unused workflow and blocks deletion while projects exist', () => {
    const first = createWorkflow({ id: 'workflow-delete-first', title: '待删除工作流' })
    const second = createWorkflow({ id: 'workflow-delete-second', title: '保留工作流' })
    const baseStore = { ...defaultStore(), workflows: [first, second], projectFlowStates: [] }
    const deleted = removeUnusedWorkflow(baseStore, first.id)
    expect(deleted.workflows.map((item) => item.id)).toEqual([second.id])
    expect(deleted.prompts).toEqual(baseStore.prompts)

    const protectedStore = {
      ...baseStore,
      projectFlowStates: [createProjectFlowState(first, 'project-protected', '受保护项目', { topic: '测试' })]
    }
    expect(removeUnusedWorkflow(protectedStore, first.id)).toBe(protectedStore)
  })
})

describe('workflow node delivery payload', () => {
  it('keeps project-management metadata out of copied Skill text', () => {
    const skill: SkillItem = {
      id: 'skill:test-controller',
      name: 'sci-research-paper-controller',
      title: 'SCI research paper controller',
      summary: 'Controls the research-paper workflow.',
      tags: [],
      variables: [],
      favorite: false,
      path: 'C:\\skills\\sci-research-paper-controller\\SKILL.md',
      source: 'custom',
      contentPreview: '# Controller',
      updatedAt: '2026-08-11T00:00:00.000Z'
    }
    const payload = buildNodePayload(
      nodeFromSkill(skill, 0),
      defaultStore(),
      [skill],
      ['C:\\projects\\paper\\source.pdf'],
      '优先检查附件中的研究数据。',
      'C:\\skills\\sci-research-paper-controller'
    )

    expect(payload).toContain('Skill 名称：$sci-research-paper-controller')
    expect(payload).toContain('Skill 所在目录：C:\\skills\\sci-research-paper-controller')
    expect(payload).toContain('1. C:\\projects\\paper\\source.pdf')
    expect(payload).toContain('优先检查附件中的研究数据。')
    expect(payload).not.toContain('Format Flow 项目上下文')
    expect(payload).not.toContain('workflow=')
    expect(payload).not.toContain('projectId=')
    expect(payload).not.toContain('nodeKey=')
    expect(payload).not.toContain('deliveryMode')
  })
})

describe('workflow creation wizard', () => {
  const skill: SkillItem = {
    id: 'skill:wizard-test',
    name: 'wizard-test',
    title: '向导测试 Skill',
    summary: '用于检查节点资源绑定。',
    tags: [],
    variables: [],
    favorite: false,
    path: 'C:\\skills\\wizard-test\\SKILL.md',
    source: 'custom',
    contentPreview: '# Wizard test',
    contentFingerprint: 'wizard-fingerprint',
    updatedAt: '2026-08-11T00:00:00.000Z'
  }
  const node = nodeFromSkill(skill, 0)
  const workflow = createWorkflow({
    title: '清晰创建向导',
    nodes: [node],
    checkpointBlueprint: [{ checkpointKey: 'after-skill', title: 'Skill 完成', afterNodeKey: node.nodeKey, requiredArtifacts: ['skill_output'] }]
  })
  const commonProps = {
    draft: workflow,
    prompts: [],
    skills: [skill],
    mcpServers: [],
    onDraft: () => undefined,
    onStep: () => undefined,
    onCancel: () => undefined,
    onFinish: () => undefined
  }

  it('uses explicit stage controls instead of a JSON editor', () => {
    const markup = renderToStaticMarkup(createElement(WizardModal, { ...commonProps, step: 2 }))
    expect(markup).toContain('阶段设置')
    expect(markup).toContain('阶段名称')
    expect(markup).toContain('删除')
    expect(markup).not.toContain('wizard-json')
  })

  it('shows editable node and checkpoint forms with delete actions', () => {
    const nodeMarkup = renderToStaticMarkup(createElement(WizardModal, { ...commonProps, step: 3 }))
    const checkpointMarkup = renderToStaticMarkup(createElement(WizardModal, { ...commonProps, step: 4 }))
    expect(nodeMarkup).toContain('节点设置')
    expect(nodeMarkup).toContain('绑定资源')
    expect(nodeMarkup).toContain('删除')
    expect(checkpointMarkup).toContain('检查点设置')
    expect(checkpointMarkup).toContain('在此节点完成后')
    expect(checkpointMarkup).toContain('删除')
  })

  it('uses completed nodes for history browsing without changing project status', () => {
    const project = recordDelivery(
      workflow,
      createProjectFlowState(workflow, 'project-return-node', '返回节点', { topic: '测试' }),
      'copy-all',
      '$wizard-test',
      []
    )
    const snapshot = JSON.stringify(project)
    expect(project.status).toBe('completed')
    expect(projectNodeNavigationRole(workflow, project, node.nodeKey)).toBe('latest')
    expect(JSON.stringify(project)).toBe(snapshot)

    const markup = renderToStaticMarkup(createElement(ProgressSummary, { workflow, project, viewedNodeKey: node.nodeKey, onSelect: () => undefined }))
    expect(markup).toContain('查看最新完成节点')
    expect(markup).toContain('浏览不会改变项目状态')
    expect(markup).not.toContain('disabled=""')

    const historyMarkup = renderToStaticMarkup(createElement(HistoricalNodeView, {
      node,
      project,
      projectStatus: '已完成',
      onLatest: () => undefined
    }))
    expect(historyMarkup).toContain('仅查看历史节点')
    expect(historyMarkup).toContain('项目状态保持为“已完成”')
    expect(historyMarkup).not.toContain('记录交付并进入下一节点')

    const activeProject = createProjectFlowState(workflow, 'project-latest-node', '最新节点', { topic: '测试' })
    expect(projectNodeNavigationRole(workflow, activeProject, activeProject.currentNodeKey)).toBe('current')
    const activeMarkup = renderToStaticMarkup(createElement(ProgressSummary, { workflow, project: activeProject, viewedNodeKey: '', onSelect: () => undefined }))
    expect(activeMarkup).toContain('返回最新节点')
  })
})

describe('review output outline', () => {
  it('extracts the previous Skill output files without including later quality sections', () => {
    const outline = extractSkillOutputOutline(`
## Output Files

\`\`\`text
00-controller/
├── 输出/
├── 需要人工核查.md
└── 下一步交接记录.md
\`\`\`

核心产物：

- \`项目状态.md\`
- \`允许动作判定.md\`
- \`下一步交接记录.md\`

## Quality Gate

- 不应进入输出大纲
`)

    expect(outline).toEqual([
      '需要人工核查.md',
      '下一步交接记录.md',
      '项目状态.md',
      '允许动作判定.md'
    ])
  })

  it('allows change-reason files and shows saved attachments in Review history', () => {
    const reviewNode = {
      ...nodeFromSkill({
        id: 'skill:review-source',
        name: 'review-source',
        title: '审查来源 Skill',
        summary: '',
        tags: [],
        variables: [],
        favorite: false,
        path: 'C:\\skills\\review-source\\SKILL.md',
        source: 'custom' as const,
        contentPreview: '',
        updatedAt: '2026-08-12T00:00:00.000Z'
      }, 0),
      nodeKey: 'review-files',
      type: 'review' as const,
      resourceRef: undefined,
      requiresReview: true,
      reviewChecklist: [{ key: 'complete', label: '输出已完成', required: true }]
    }
    const workflow = createWorkflow({ nodes: [reviewNode] })
    const project = createProjectFlowState(workflow, 'project-review-files', '审查附件项目', { topic: '审查附件' })
    const reviewed = submitReview(workflow, project, { complete: false }, '补充证明材料', ['C:\\projects\\修改说明.docx']).state
    const markup = renderToStaticMarkup(createElement(ReviewNodeEditor, {
      node: reviewNode,
      project: reviewed,
      sourceSkillName: '审查来源 Skill',
      outputOutline: ['结果文件'],
      outlineLoading: false,
      checklist: {},
      reason: '',
      attachmentPaths: [],
      onChecklist: () => undefined,
      onReason: () => undefined,
      onFiles: () => undefined,
      onRemoveAttachment: () => undefined,
      onSubmit: () => undefined
    }))

    expect(markup).toContain('更改原因附件')
    expect(markup).toContain('type="file"')
    expect(markup).toContain('multiple=""')
    expect(markup).toContain('C:\\projects\\修改说明.docx')
  })
})

describe('project history manager', () => {
  it('renders searchable project details and all CRUD entry points in a modal', () => {
    const workflow = createWorkflow({
      id: 'workflow-project-history',
      templateKey: 'workflow-project-history',
      templateVersion: '1.0.0',
      title: '项目历史测试工作流'
    })
    const project = createProjectFlowState(workflow, 'project-history-1', '历史项目一', { topic: '项目主题' })
    const markup = renderToStaticMarkup(createElement(ProjectHistoryModal, {
      workflow,
      workflows: [workflow],
      projects: [project],
      projectDirectory: 'C:\\Format Flow\\projects',
      onClose: () => undefined,
      onCreate: async () => undefined,
      onUpdate: async () => undefined,
      onDelete: async () => false,
      onOpen: () => undefined
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('历史项目一')
    expect(markup).toContain('项目主题')
    expect(markup).toContain('搜索项目记录')
    expect(markup).toContain('新建项目')
    expect(markup).toContain('修改')
    expect(markup).toContain('删除')
    expect(markup).toContain('打开执行')
    expect(markup).not.toContain('工作流版本')
    expect(markup).not.toContain('v1.0.0')
  })
})
