<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

import { caseApi, runApi } from '@/api'
import type {
  Artifact,
  CaseDetail,
  ImportReport,
  LintItem,
  RunBrief,
  RunDetail,
  TraceRow,
  VersionDetail,
  VersionRow,
} from '@/api/types'
import { subscribeRunEvents } from '@/api/sse'
import ArtifactImage from '@/components/ArtifactImage.vue'
import HtmlViewer from '@/components/HtmlViewer.vue'
import PlanPreview from '@/components/PlanPreview.vue'
import StepResult from '@/components/StepResult.vue'
import StatusTag from '@/components/StatusTag.vue'
import TraceLog from '@/components/TraceLog.vue'
import YamlEditor from '@/components/YamlEditor.vue'
import { useRunStarter } from '@/composables/useRunStarter'
import { useUiStore } from '@/stores/ui'
import { downloadArtifact, openArtifactTab } from '@/utils/artifact'
import { formatDateTime, formatDuration, formatSize, formatTime, stepChipClass, stepStatusText } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { runCase } = useRunStarter()

const caseId = computed(() => String(route.params.id || ''))
const detail = ref<CaseDetail | null>(null)
const yamlText = ref('')
const savedText = ref('')
const editorRef = ref<InstanceType<typeof YamlEditor> | null>(null)

const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const errors = ref<LintItem[]>([])
const warnings = ref<LintItem[]>([])
const plan = ref<Record<string, unknown> | null>(null)
const planEnv = ref('')

const nlDesc = ref('')
const drafting = ref(false)
const planView = ref(false)

const importVisible = ref(false)
const importScript = ref('')
const importKeepUrl = ref(false)
const importing = ref(false)
const importReport = ref<ImportReport | null>(null)
const importTitle = computed(() => {
  const report = importReport.value
  if (!report) return ''
  const pending = report.issues.length ? `，${report.issues.length} 条待人工` : ''
  return `导入报告：${report.steps} 步 · ${report.checks} 条断言（显式 ${report.explicit} / 前瞻 ${report.lookahead} / 兜底 ${report.fallback}）${pending}`
})

const versionsVisible = ref(false)
const versions = ref<VersionRow[]>([])
const previewVersion = ref<VersionDetail | null>(null)

const historyRuns = ref<RunBrief[]>([])
const activeRun = ref<RunDetail | null>(null)
const liveRows = ref<TraceRow[]>([])
const activeTab = ref('steps')
const stopping = ref(false)
const liveStep = ref<number | null>(null)
const reportView = ref<{ visible: boolean; url: string }>({ visible: false, url: '' })
let unsubscribe: (() => void) | null = null

const dirty = computed(() => yamlText.value !== savedText.value)
const envMismatch = computed(() => {
  const declared = planEnv.value
  const chosen = ui.currentEnv?.name || ''
  return Boolean(declared && chosen && declared !== chosen)
})
const running = computed(() => ['queued', 'running'].includes(activeRun.value?.status || ''))
const planStepCount = computed(() => ((plan.value as { steps?: unknown[] } | null)?.steps || []).length)

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    const data = await caseApi.detail(caseId.value)
    detail.value = data
    yamlText.value = data.yaml_text || ''
    savedText.value = data.yaml_text || ''
    errors.value = []
    warnings.value = []
    plan.value = null
    planEnv.value = ''
    previewVersion.value = null
    importReport.value = null
    const wanted = typeof route.query.run === 'string' ? route.query.run : ''
    if (wanted) await pickRun(wanted, false)
    else if (data.last_run) await pickRun(data.last_run.id, false)
    else activeRun.value = null
    void refreshHistory()
  } catch (error) {
    showApiError(error, '用例加载失败')
  } finally {
    loading.value = false
  }
}

async function refreshHistory(): Promise<void> {
  try {
    const data = await runApi.list({ case_id: caseId.value, size: 10 })
    historyRuns.value = data.items
  } catch {
    historyRuns.value = []
  }
}

// --- 校验与保存 ---

async function validate(quiet = false): Promise<boolean> {
  validating.value = true
  try {
    const result = await caseApi.validate(caseId.value, yamlText.value)
    errors.value = result.errors || []
    warnings.value = result.warnings || []
    plan.value = result.plan
    planEnv.value = result.env || ''
    if (!quiet) {
      if (result.ok) {
        const steps = ((result.plan || {}) as { steps?: unknown[] }).steps || []
        ElMessage.success(`校验通过（${steps.length} 步）${warnings.value.length ? `，${warnings.value.length} 条提醒` : ''}`)
      } else {
        ElMessage.error(`校验未通过：${errors.value.length} 个问题，见编辑器标红`)
      }
    }
    return result.ok
  } catch (error) {
    showApiError(error, '校验失败')
    return false
  } finally {
    validating.value = false
  }
}

async function save(comment = '', quiet = false): Promise<boolean> {
  if (!detail.value) return false
  saving.value = true
  try {
    const result = await caseApi.save(caseId.value, {
      yaml_text: yamlText.value,
      version: detail.value.version,
      comment,
    })
    detail.value = { ...detail.value, version: result.version, name: result.name }
    savedText.value = yamlText.value
    warnings.value = result.warnings || []
    errors.value = []
    if (!quiet) {
      ElMessage.success(`已保存为 v${result.version}${(result.warnings || []).length ? `（${(result.warnings || []).length} 条提醒）` : ''}`)
    }
    void validate(true)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'version_conflict') {
      await resolveConflict()
      return false
    }
    showApiError(error, '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

/** 乐观锁撞车：把服务器版本拉下来，让用户选一边。 */
async function resolveConflict(): Promise<void> {
  let server: CaseDetail
  try {
    server = await caseApi.detail(caseId.value)
  } catch (error) {
    showApiError(error, '取服务器版本失败')
    return
  }
  try {
    await ElMessageBox.confirm(
      `用例已被他人更新（服务器 v${server.version}，你手上是 v${detail.value?.version ?? '?'}）。\n` +
        '点「用我的覆盖」会以最新版本号为基底再存一次；点「放弃我的」丢弃本地改动。',
      '版本冲突',
      { type: 'warning', confirmButtonText: '用我的覆盖', cancelButtonText: '放弃我的', distinguishCancelAndClose: true },
    )
  } catch (action) {
    if (action === 'cancel') {
      yamlText.value = server.yaml_text || ''
      savedText.value = server.yaml_text || ''
      detail.value = server
      await validate(true)
      ElMessage.info('已切到服务器版本')
    }
    return
  }
  detail.value = server
  await save('冲突合并：以本地改动覆盖')
}

async function onSaveShortcut(): Promise<void> {
  await save()
}

async function openVersions(): Promise<void> {
  try {
    const data = await caseApi.versions(caseId.value)
    versions.value = data.items
    versionsVisible.value = true
  } catch (error) {
    showApiError(error, '取版本列表失败')
  }
}

async function previewVer(row: VersionRow): Promise<void> {
  try {
    previewVersion.value = await caseApi.version(caseId.value, row.version)
  } catch (error) {
    showApiError(error, '取版本内容失败')
  }
}

async function rollback(): Promise<void> {
  const target = previewVersion.value
  if (!target || !detail.value) return
  try {
    await ElMessageBox.confirm(
      `回滚到 v${target.version}？（会以该内容再存一个新版本，历史不丢）`,
      '回滚',
      { type: 'warning', confirmButtonText: '回滚', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await caseApi.rollback(caseId.value, target.version)
    versionsVisible.value = false
    previewVersion.value = null
    await load(true)
    ElMessage.success(`已回滚到 v${target.version}`)
  } catch (error) {
    showApiError(error, '回滚失败')
  }
}

async function useVersionInEditor(): Promise<void> {
  const target = previewVersion.value
  if (!target) return
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('编辑器里有未保存的改动，会被这个版本覆盖。继续？', '覆盖编辑器', {
        type: 'warning',
        confirmButtonText: '覆盖',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  yamlText.value = target.yaml_text
  versionsVisible.value = false
  ElMessage.info(`已把 v${target.version} 放进编辑器（还没保存）`)
}

// --- 自然语言草稿 ---

async function makeDraft(): Promise<void> {
  if (!nlDesc.value.trim()) {
    ElMessage.warning('先写一句要做的事')
    return
  }
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('当前的 YAML 会被草稿替换（草稿不落库，保存后才有版本）。继续？', '生成草稿', {
        type: 'warning',
        confirmButtonText: '替换',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  drafting.value = true
  try {
    const result = await caseApi.draft(caseId.value, nlDesc.value.trim(), ui.currentEnv?.base_url || '')
    yamlText.value = result.yaml_text
    warnings.value = result.warnings || []
    errors.value = []
    plan.value = null
    importReport.value = null
    await validate(true)
    ElMessage.success('草稿已生成，确认无误后点保存（保存前不落库）')
  } catch (error) {
    showApiError(error, '生成草稿失败（自然语言需要文本模型 key）')
  } finally {
    drafting.value = false
  }
}

// --- 老脚本导入（midscene.js → 用例 YAML） ---

async function runImport(): Promise<void> {
  const script = importScript.value.trim()
  if (!script) {
    ElMessage.warning('先把老脚本粘贴进来')
    return
  }
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('当前的 YAML 会被导入结果替换（导入不落库，保存后才有版本）。继续？', '导入老脚本', {
        type: 'warning',
        confirmButtonText: '替换',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  importing.value = true
  try {
    const result = await caseApi.importMidscene(caseId.value, script, importKeepUrl.value)
    yamlText.value = result.yaml_text
    importReport.value = result.report
    errors.value = []
    warnings.value = []
    plan.value = null
    importVisible.value = false
    importScript.value = ''
    await validate(true)
    const report = result.report
    const pending = report.issues.length ? `，${report.issues.length} 条待人工（见导入报告）` : ''
    ElMessage.success(`已导入 ${report.steps} 步 · ${report.checks} 条断言${pending}`)
  } catch (error) {
    showApiError(error, '导入失败')
  } finally {
    importing.value = false
  }
}

// --- 快捷插入（右侧面板） ---

/** 唯一字段：YAML 里已经有就跳过去，没有才追加 —— 不会造出重复键 */
const FIELD_BUTTONS: Array<{ label: string; key: string; snippet: string }> = [
  { label: '用例标题', key: 'title', snippet: 'title: ' },
  { label: '优先级', key: 'priority', snippet: 'priority: P2' },
  { label: '标签', key: 'tags', snippet: 'tags: []' },
  { label: '负责人', key: 'owner', snippet: "owner: ''" },
  { label: '环境', key: 'env', snippet: "env: ''" },
  { label: '账号密码', key: 'vars', snippet: 'vars:\n  账号: ${{secret.账号}}\n  密码: ${{secret.密码}}' },
]

function insertField(field: { label: string; key: string; snippet: string }): void {
  const mode = editorRef.value?.upsertField(field.key, field.snippet)
  if (mode === 'located') ElMessage.info(`${field.label} 已有，已跳到那一行（改完记得保存）`)
  else if (mode === 'appended') ElMessage.success(`已在末尾加上 ${field.label}，填好值再保存`)
}

/** 浮层改用 fixed 定位：默认 absolute 的浮层挂在 body 上会把文档撑高——冒出窗口滚动条、
    浏览器为露出菜单还会自动滚窗，整个页面会跳一下 */
const FIXED_POPPER = { strategy: 'fixed' }

/** 短窗口兜底：fixed 浮层不撑页面了，但 popper 自带的避让在这里不生效，菜单底部会超出窗口。
    打开后量一次：超出就把浮层整体上移（marginTop，不碰 popper 的 inset 定位），比窗口还高就限高。
    用 offsetTop/offsetHeight（布局值，不受入场缩放进度影响）测量；先还原再量，重复跑安全 */
let paletteFitOff: (() => void) | null = null

function stopPaletteFit(): void {
  paletteFitOff?.()
  paletteFitOff = null
}

function fitPaletteMenu(): void {
  const applyFit = (): void => {
    const popper = [...document.querySelectorAll<HTMLElement>('.el-dropdown__popper')]
      .find((el) => getComputedStyle(el).display !== 'none')
    if (!popper) return
    popper.style.marginTop = ''
    const pad = 12
    const vh = window.innerHeight
    const maxH = vh - pad * 2
    const naturalH = popper.offsetHeight
    if (naturalH > maxH) {
      popper.style.maxHeight = `${maxH}px`
      popper.style.overflowY = 'auto'
    } else {
      popper.style.maxHeight = ''
      popper.style.overflowY = ''
    }
    const h = Math.min(naturalH, maxH)
    const top = popper.offsetTop
    let shift = 0
    if (top + h > vh - pad) shift = vh - pad - (top + h)
    if (top + shift < pad) shift = pad - top
    popper.style.marginTop = shift ? `${shift}px` : ''
  }
  const retry = (tries: number): void => {
    const popper = [...document.querySelectorAll<HTMLElement>('.el-dropdown__popper')]
      .find((el) => getComputedStyle(el).display !== 'none')
    if (popper && popper.offsetTop > 0) applyFit()
    else if (tries > 0) requestAnimationFrame(() => retry(tries - 1))
    else applyFit()
  }
  if (!paletteFitOff) {
    // 浮层开着时触发器还会被滚动/改窗挪位置，popper 会更新 inset 但不会带上我们的位移，跟着重算
    const onMove = (): void => {
      requestAnimationFrame(applyFit)
    }
    window.addEventListener('scroll', onMove, { capture: true, passive: true })
    window.addEventListener('resize', onMove, { passive: true })
    paletteFitOff = () => {
      window.removeEventListener('scroll', onMove, { capture: true })
      window.removeEventListener('resize', onMove)
    }
  }
  void nextTick(() => {
    requestAnimationFrame(() => retry(10))
    window.setTimeout(applyFit, 300) // 入场动画结束后校正一遍
  })
}

/** 动作模板：goal 骨架与内核可执行动作白名单一致（ui_agent/act/executor.py 的 EXECUTABLE） */
const STEP_TEMPLATES: Array<{ key: string; label: string; desc: string; goal: string }> = [
  { key: 'open', label: '打开页面', desc: '默认用环境地址；要换页给该步加 url:', goal: '打开「」页面' },
  { key: 'click', label: '点击', desc: '按钮 / 链接 / 菜单项', goal: '点击「」' },
  { key: 'input', label: '输入文本', desc: '值放 vars，引用不能写进 goal', goal: '在「」填入用例给定的值' },
  { key: 'select', label: '下拉选择', desc: '在「下拉框」里选中某个选项', goal: '在「」下拉中选择「」' },
  { key: 'upload', label: '上传文件', desc: 'vars 给文件路径，键名随控件标签', goal: '上传文件到「」' },
  { key: 'key', label: '按键', desc: 'Enter 提交 / Escape 关浮层', goal: '按「Enter」键' },
  { key: 'hover', label: '悬停', desc: '展开子菜单或提示', goal: '悬停到「」' },
  { key: 'scroll', label: '滚动', desc: '滚动到某元素可见', goal: '滚动到「」' },
  { key: 'wait', label: '等待', desc: '控件未出现或结果加载中', goal: '等待页面更新' },
  { key: 'blank', label: '空白步骤', desc: 'goal 和断言都自己写', goal: '' },
]

function addStep(key: string): void {
  const tpl = STEP_TEMPLATES.find((item) => item.key === key) ?? STEP_TEMPLATES[STEP_TEMPLATES.length - 1]
  const indent = editorRef.value?.listIndent('steps') ?? 0
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)
  editorRef.value?.appendSnippet([`${pad}- goal: ${tpl.goal}`, `${inner}checks:`, `${inner}- text_contains: `])
  ElMessage.success(tpl.goal
    ? `已追加「${tpl.label}」步骤骨架：把「」里补上目标描述，断言按需改`
    : '已在末尾追加一个步骤（goal + checks 骨架），断言类型和值按需改')
}

/** 断言模板：类型与内核断言白名单一致（ui_agent/verify/asserts.py 的 KINDS） */
const ASSERT_TEMPLATES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'text_contains', label: '文本包含', desc: '页面可见文字里出现这段内容' },
  { key: 'url_contains', label: '地址包含', desc: '当前地址里包含这段路径 / 参数' },
  { key: 'title_contains', label: '标题包含', desc: '浏览器标签标题里出现这段文字' },
  { key: 'element_exists', label: '元素存在', desc: '页面上找得到这个元素（按描述匹配）' },
  { key: 'element_absent', label: '元素不存在', desc: '页面上找不到这个元素（如浮层已关）' },
  { key: 'element_value', label: '元素值等于', desc: '控件当前值 = 期望值，写法 描述|期望值' },
]

function addCheck(key: string): void {
  const tpl = ASSERT_TEMPLATES.find((item) => item.key === key) ?? ASSERT_TEMPLATES[0]
  const ok = editorRef.value?.appendCheck(`${tpl.key}: `)
  if (ok) ElMessage.success(`已给最后一步加上「${tpl.label}」断言，把值补上：${tpl.desc}`)
  else ElMessage.warning('还没有步骤，先点「新增步骤」')
}

// --- 复制 / 删除 ---

async function copyCase(): Promise<void> {
  if (!detail.value) return
  try {
    const { value } = await ElMessageBox.prompt('新用例名称', `复制「${detail.value.name}」`, {
      inputValue: `${detail.value.name} 副本`,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    const created = await caseApi.copy(caseId.value, { name: value.trim() })
    ElMessage.success(`已复制为 ${created.id}`)
    void router.push({ name: 'case-detail', params: { id: created.id } })
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '复制失败')
  }
}

async function deleteCase(): Promise<void> {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(
      `删除用例「${detail.value.name}」？（软删除，YAML 会先落一份到 trash）`,
      '二次确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await caseApi.remove(caseId.value)
    ElMessage.success('已删除')
    void router.replace({ name: 'scenario', params: { id: detail.value.scenario_code || '' } })
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除失败')
  }
}

// --- 运行区 ---

function stopStream(): void {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
}

function startStream(runId: string): void {
  stopStream()
  liveRows.value = []
  liveStep.value = null
  unsubscribe = subscribeRunEvents(runId, {
    trace: (row) => {
      liveRows.value = [...liveRows.value, row]
      if (typeof row.step === 'number') liveStep.value = row.step
    },
    status: (data) => {
      if (activeRun.value && activeRun.value.id === runId) {
        activeRun.value = {
          ...activeRun.value,
          status: String(data.status || activeRun.value.status) as RunDetail['status'],
          detail: String(data.detail || activeRun.value.detail),
        }
        if (typeof data.step === 'number') liveStep.value = data.step
      }
    },
    done: async () => {
      stopStream()
      await pickRun(runId, false)
      void refreshHistory()
      if (activeRun.value) {
        ElMessage({ message: `运行结束：${activeRun.value.detail || activeRun.value.status}`, type: activeRun.value.status === 'passed' ? 'success' : 'warning' })
      }
    },
  })
}

async function pickRun(runId: string, announce = true): Promise<void> {
  try {
    const data = await runApi.detail(runId)
    activeRun.value = data
    if (['queued', 'running'].includes(data.status)) startStream(runId)
    else stopStream()
    if (announce) activeTab.value = 'steps'
  } catch (error) {
    showApiError(error, '取运行详情失败')
  }
}

async function startRun(mode: 'debug' | 'ci'): Promise<void> {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm(
        '有未保存的改动：运行用的是已保存版本。要先保存吗？',
        '未保存的改动',
        { type: 'warning', confirmButtonText: '保存并运行', cancelButtonText: '直接运行', distinguishCancelAndClose: true },
      )
    } catch (action) {
      if (action === 'close') return
      if (action === 'cancel') {
        const run = await runCase(caseId.value, mode)
        if (run) await pickRun(run.id)
        return
      }
    }
    const saved = await save('运行前保存')
    if (!saved && dirty.value) return
  }
  const run = await runCase(caseId.value, mode)
  if (run) await pickRun(run.id)
}

async function stopRun(): Promise<void> {
  if (!activeRun.value) return
  stopping.value = true
  try {
    await runApi.stop(activeRun.value.id)
    ElMessage.warning('已请求停止（子进程树会被终止，产物可能不完整）')
    await pickRun(activeRun.value.id, false)
  } catch (error) {
    showApiError(error, '停止失败')
  } finally {
    stopping.value = false
  }
}

async function rebuildReport(): Promise<void> {
  if (!activeRun.value) return
  try {
    await runApi.rebuildReport(activeRun.value.id)
    ElMessage.success('报告已重出')
    await pickRun(activeRun.value.id, false)
  } catch (error) {
    showApiError(error, '重出报告失败')
  }
}

function openReport(): void {
  if (!activeRun.value) return
  reportView.value = { visible: true, url: activeRun.value.report_url }
}

async function openReportTab(): Promise<void> {
  if (!activeRun.value) return
  try {
    await openArtifactTab(activeRun.value.report_url)
  } catch (error) {
    showApiError(error, '报告打开失败（可能还没生成，点『重出报告』）')
  }
}

function openArtifact(row: Artifact): void {
  // HTML 报告在弹窗里看：新标签会被浏览器弹窗拦截，这里更稳
  if (row.path.endsWith('.html')) {
    reportView.value = { visible: true, url: row.url }
    return
  }
  void openArtifactTab(row.url)
}

function stepChips(): Array<{ index: number; status: string; goal: string }> {
  return (activeRun.value?.steps_detail || []).map((step) => ({
    index: step.index,
    status: step.status,
    goal: step.goal,
  }))
}

function artifactTag(kind: string): string {
  const map: Record<string, string> = {
    screenshot: '截图',
    snapshot: '快照',
    report: '报告',
    trace: '决策日志',
    summary: '汇总',
    plan: 'TestPlan',
    actions: '动作历史',
    log: '日志',
  }
  return map[kind] || '其他'
}

function jumpToLine(line: number): void {
  editorRef.value?.revealLine(line)
}

watch(caseId, () => void load())

watch(
  () => route.query.run,
  (value) => {
    if (typeof value === 'string' && value && value !== activeRun.value?.id) void pickRun(value, false)
  },
)

onMounted(async () => {
  void ui.loadEnvs()
  await load()
  // 静默编译一次：页面一打开就有 TestPlan、标红和环境不一致提示，用户不用先点「校验」
  if (detail.value) void validate(true)
})

onBeforeUnmount(stopStream)
onBeforeUnmount(stopPaletteFit)

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('用例有未保存的改动，离开会丢失。', '未保存', {
      type: 'warning',
      confirmButtonText: '丢弃并离开',
      cancelButtonText: '留在本页',
    })
    return true
  } catch {
    return false
  }
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="crumb">
      <span class="link" @click="router.push({ name: 'cases' })">用例管理</span>
      <span> / </span>
      <span
        v-if="detail?.scenario_code"
        class="link"
        @click="router.push({ name: 'scenario', params: { id: detail.scenario_code } })"
      >
        {{ detail?.scenario_name || detail?.scenario_code }}
      </span>
      <span v-else>—</span>
      <span> / </span>
      <b>{{ detail?.name || caseId }}</b>
      <span v-if="detail" class="muted" style="margin-left: 8px">
        {{ detail.id }} · v{{ detail.version }} · {{ detail.updated_by }} {{ formatDateTime(detail.updated_at) }}
      </span>
    </div>

    <el-alert
      v-if="envMismatch"
      type="warning"
      :closable="false"
      style="margin-bottom: 10px"
      :title="`用例声明 env: ${planEnv}，顶栏选的是 ${ui.currentEnv?.name}；运行时以顶栏环境注入 base_url 与密钥。`"
    />
    <el-alert
      v-if="warnings.length"
      type="info"
      :closable="false"
      style="margin-bottom: 10px"
      :title="`${warnings.length} 条校验提醒（不拦保存）`"
    >
      <div v-for="(item, index) in warnings" :key="`w${index}`" class="muted" style="cursor: pointer" @click="jumpToLine(item.line)">
        第 {{ item.line }} 行 · {{ item.code }}：{{ item.message }}
      </div>
    </el-alert>

    <div class="detail-grid" style="display: flex; gap: 12px; align-items: flex-start">
      <el-card class="editor-panel" style="flex: 1; min-width: 0; display: flex; flex-direction: column">
        <template #header>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <b>{{ detail?.name }}</b>
            <el-tag size="small" disable-transitions>{{ detail?.priority }}</el-tag>
            <el-tag v-for="tag in detail?.tags || []" :key="tag" size="small" type="info" disable-transitions>{{ tag }}</el-tag>
            <span v-if="dirty" class="muted" style="color: #e6a23c">未保存</span>
            <div style="flex: 1" />
            <el-button size="small" :loading="validating" @click="validate()">校验</el-button>
            <el-button size="small" type="primary" :loading="saving" @click="save()">保存</el-button>
            <el-dropdown trigger="click">
              <el-button size="small">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openVersions()">历史版本</el-dropdown-item>
                  <el-dropdown-item @click="copyCase()">复制用例</el-dropdown-item>
                  <el-dropdown-item divided @click="deleteCase()">删除用例</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>

        <div class="nl-box">
          <el-input
            v-model="nlDesc"
            type="textarea"
            :rows="3"
            placeholder="用一句自然语言说清：打开哪个页面、做什么、达成什么。例如「在登录页输入账号密码，登录后标题里出现 工作台」"
          />
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 6px">
            <div class="muted" style="flex: 1">
              走文本模型（需要 key，未配则报错）；生成的只是草稿，保存前不落库、不会自动运行。
            </div>
            <el-button size="small" @click="importVisible = true">导入老脚本</el-button>
            <el-button type="primary" size="small" :loading="drafting" @click="makeDraft()">生成草稿</el-button>
          </div>
        </div>

        <el-alert
          v-if="importReport"
          :type="importReport.issues.length ? 'warning' : 'success'"
          :closable="true"
          style="margin-top: 10px"
          :title="importTitle"
          @close="importReport = null"
        >
          <div v-if="importReport.vars.length" class="muted" style="font-size: 12.5px">
            变量：{{ importReport.vars.join('、') }}
          </div>
          <div
            v-for="(item, index) in importReport.issues"
            :key="`ii${index}`"
            style="color: #e6a23c; font-size: 12.5px"
          >
            待人工：{{ item }}
          </div>
          <div v-for="(item, index) in importReport.notes" :key="`in${index}`" class="muted" style="font-size: 12.5px">
            提示：{{ item }}
          </div>
        </el-alert>

        <div class="muted" style="margin: 12px 0 6px">YAML 正文（与上面是同一份内容，也可以直接改）</div>
        <YamlEditor
          ref="editorRef"
          v-model="yamlText"
          :errors="errors"
          :warnings="warnings"
          @save="onSaveShortcut"
        />

        <div v-if="errors.length" style="margin-top: 8px">
          <div v-for="(item, index) in errors" :key="`e${index}`" style="color: #f56c6c; font-size: 12.5px; cursor: pointer" @click="jumpToLine(item.line)">
            第 {{ item.line }} 行 · {{ item.code }}：{{ item.message }}
          </div>
        </div>
        <div class="muted" style="margin-top: 8px">Ctrl/Cmd + S 保存；保存会先过校验，不过不落库。</div>
      </el-card>

      <el-card class="palette-panel" style="flex: 0 0 240px">
        <template #header>
          <div style="display: flex; align-items: center; gap: 8px">
            <b>快捷插入</b>
            <span class="muted">写进编辑器，不自动保存</span>
          </div>
        </template>
        <div class="palette-hint">字段 · 已有就跳过去，没有才补</div>
        <div class="palette-list">
          <el-button v-for="field in FIELD_BUTTONS" :key="field.key" size="small" @click="insertField(field)">
            {{ field.label }}
          </el-button>
        </div>
        <div class="palette-hint" style="margin-top: 14px">可重复 · 总是追加到末尾</div>
        <div class="palette-list">
          <el-dropdown trigger="click" :popper-options="FIXED_POPPER"
                       @command="(cmd: string) => addStep(cmd)"
                       @visible-change="(v: boolean) => v ? fitPaletteMenu() : stopPaletteFit()">
            <el-button size="small">
              新增步骤
              <el-icon style="margin-left: auto"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu class="palette-menu">
                <el-dropdown-item v-for="tpl in STEP_TEMPLATES" :key="tpl.key" :command="tpl.key"
                                  :divided="tpl.key === 'blank'">
                  <div class="palette-menu-name">{{ tpl.label }}</div>
                  <div class="palette-menu-desc">{{ tpl.desc }}</div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" :popper-options="FIXED_POPPER"
                       @command="(cmd: string) => addCheck(cmd)"
                       @visible-change="(v: boolean) => v ? fitPaletteMenu() : stopPaletteFit()">
            <el-button size="small">
              新增断言
              <el-icon style="margin-left: auto"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu class="palette-menu">
                <el-dropdown-item v-for="tpl in ASSERT_TEMPLATES" :key="tpl.key" :command="tpl.key">
                  <div class="palette-menu-name">{{ tpl.label }}</div>
                  <div class="palette-menu-desc">{{ tpl.desc }}</div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-card>
    </div>

    <el-card style="margin-top: 12px">
      <template #header>
        <div class="run-bar">
          <b>运行</b>
          <el-button size="small" type="primary" @click="startRun('debug')">运行 debug</el-button>
          <el-button size="small" @click="startRun('ci')">运行 ci</el-button>
          <el-button v-if="running" size="small" type="danger" :loading="stopping" @click="stopRun()">停止</el-button>
          <el-button v-if="activeRun" size="small" @click="rebuildReport()">重出报告</el-button>
          <el-button v-if="activeRun?.report_exists" size="small" text type="primary" @click="openReport()">打开报告</el-button>
          <div style="flex: 1" />
          <template v-if="activeRun">
            <StatusTag :status="activeRun.status" />
            <span class="muted">{{ activeRun.mode }} · {{ activeRun.env }} · 用时 {{ formatDuration(activeRun.duration_ms) }}</span>
          </template>
          <span v-else class="muted">还没有运行记录</span>
          <el-button size="small" text type="primary" :disabled="!plan" @click="planView = true">
            {{ plan ? `TestPlan（编译结果 · ${planStepCount} 步）` : 'TestPlan（未编译，点「校验」）' }}
          </el-button>
        </div>
      </template>

      <div v-if="activeRun" class="steps-bar" style="margin-bottom: 8px">
        <span
          v-for="chip in stepChips()"
          :key="chip.index"
          class="chip"
          :class="[stepChipClass(chip.status), liveStep === chip.index && running ? 'running' : '']"
          :title="`${chip.index}. ${chip.goal} — ${stepStatusText(chip.status)}`"
        >
          {{ chip.index }}
        </span>
        <span class="muted">{{ activeRun.detail }}</span>
      </div>

      <el-tabs v-if="activeRun" v-model="activeTab">
        <el-tab-pane label="步骤结果" name="steps">
          <StepResult :run="activeRun" />
        </el-tab-pane>
        <el-tab-pane label="决策日志" name="trace">
          <TraceLog :run="activeRun" :live="liveRows" />
        </el-tab-pane>
        <el-tab-pane label="产物清单" name="artifacts">
          <el-table :data="activeRun.artifacts" size="small" max-height="420" empty-text="没有产物（运行未开始或目录被清理）">
            <el-table-column prop="path" label="路径" min-width="300" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag size="small" type="info" disable-transitions>{{ artifactTag(row.kind) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="90">
              <template #default="{ row }">{{ formatSize(row.size) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="openArtifact(row)">打开</el-button>
                <el-button size="small" text @click="downloadArtifact(row.url, row.path.split('/').pop() || 'artifact')">
                  下载
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div
            v-if="activeRun.artifacts.filter((item) => item.kind === 'screenshot').length"
            class="shot-wall"
            style="margin-top: 10px"
          >
            <ArtifactImage
              v-for="shot in activeRun.artifacts.filter((item) => item.kind === 'screenshot')"
              :key="shot.path"
              :url="shot.url"
              :caption="shot.path"
            />
          </div>
        </el-tab-pane>
        <el-tab-pane label="历史运行" name="history">
          <el-table :data="historyRuns" size="small" empty-text="这个用例还没跑过">
            <el-table-column label="开始" width="150">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="模式" width="80"><template #default="{ row }">{{ row.mode }}</template></el-table-column>
            <el-table-column label="环境" width="120"><template #default="{ row }">{{ row.env }}</template></el-table-column>
            <el-table-column label="结果" width="100">
              <template #default="{ row }"><StatusTag :status="row.status" /></template>
            </el-table-column>
            <el-table-column label="用时" width="90">
              <template #default="{ row }">{{ formatDuration(row.duration_ms) }}</template>
            </el-table-column>
            <el-table-column prop="detail" label="说明" min-width="200" />
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="pickRun(row.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div v-else class="empty-block">点上面的按钮跑一次，这里是步骤结果、决策日志与产物</div>
    </el-card>

    <el-drawer v-model="versionsVisible" title="历史版本" size="62%">
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-table :data="versions" size="small" style="width: 320px" @row-click="previewVer">
          <el-table-column label="版本" width="70">
            <template #default="{ row }">v{{ row.version }}</template>
          </el-table-column>
          <el-table-column label="说明" min-width="120">
            <template #default="{ row }">
              {{ row.comment || '—' }}
              <div class="muted">{{ row.author }} · {{ formatDateTime(row.created_at) }} · {{ row.size }} 字符</div>
            </template>
          </el-table-column>
        </el-table>
        <div style="flex: 1; min-width: 0">
          <div v-if="!previewVersion" class="empty-block">点左边任意版本看内容</div>
          <template v-else>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
              <b>v{{ previewVersion.version }}</b>
              <span class="muted">{{ previewVersion.author }} · {{ formatDateTime(previewVersion.created_at) }}</span>
              <div style="flex: 1" />
              <el-button size="small" @click="useVersionInEditor()">放进编辑器</el-button>
              <el-button size="small" type="primary" @click="rollback()">回滚到此版本</el-button>
            </div>
            <pre class="plan-tree" style="max-height: 62vh; overflow: auto">{{ previewVersion.yaml_text }}</pre>
          </template>
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="planView" title="TestPlan（编译结果）" width="780px" top="6vh">
      <div style="max-height: 68vh; overflow: auto">
        <PlanPreview :plan="plan" :loading="validating" />
      </div>
    </el-dialog>

    <el-dialog v-model="importVisible" title="导入老脚本（midscene.js → 用例 YAML）" width="760px" top="6vh">
      <div class="muted" style="margin-bottom: 8px; line-height: 1.8">
        把老平台的 midscene 脚本整段粘贴进来，转换在本地完成（不调模型、不起浏览器）：aiInput / aiTap / expect
        落成步骤与断言；没有断言的步骤借「下一步的入口元素」补一条 element_exists；输入值收进 vars
        （疑似凭据的值改成环境密钥引用，请到环境密钥里登记）；认不出的调用会列进导入报告，不静默丢。
      </div>
      <el-input
        v-model="importScript"
        type="textarea"
        :rows="14"
        placeholder="test('发票查验', async ({ page }) => { await page.goto('…'); await aiInput('…', '发票号码输入框'); await aiTap('查验按钮'); … })"
      />
      <el-checkbox v-model="importKeepUrl" style="margin-top: 10px">
        把脚本入口地址固定进第 1 步（默认不写，入口交给运行时的环境地址）
      </el-checkbox>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="runImport()">导入到编辑器</el-button>
      </template>
    </el-dialog>

    <HtmlViewer
      v-model="reportView.visible"
      :url="reportView.url"
      title="运行报告"
      @open-tab="openReportTab"
    />
  </div>
</template>
