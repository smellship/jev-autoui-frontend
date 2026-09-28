<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as monaco from 'monaco-editor'

import type { LintItem } from '@/api/types'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: string
    readonly?: boolean
    errors?: LintItem[]
    warnings?: LintItem[]
  }>(),
  { language: 'yaml', readonly: false, errors: () => [], warnings: () => [] },
)

const emit = defineEmits<{ 'update:modelValue': [string]; save: [] }>()

const host = ref<HTMLElement | null>(null)
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)

function applyMarkers(): void {
  const instance = editor.value
  const model = instance?.getModel()
  if (!model) return
  const markers: monaco.editor.IMarkerData[] = []
  const push = (items: LintItem[], severity: monaco.MarkerSeverity): void => {
    for (const item of items || []) {
      const line = Math.max(1, Math.min(Number(item.line) || 1, model.getLineCount()))
      markers.push({
        severity,
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: Math.max(2, (model.getLineContent(line) || '').length + 1),
        message: item.message,
        code: item.code,
        source: '用例校验',
      })
    }
  }
  push(props.errors || [], monaco.MarkerSeverity.Error)
  push(props.warnings || [], monaco.MarkerSeverity.Warning)
  monaco.editor.setModelMarkers(model, 'case-lint', markers)
}

onMounted(() => {
  if (!host.value) return
  const instance = monaco.editor.create(host.value, {
    value: props.modelValue,
    language: props.language,
    theme: 'vs',
    fontSize: 12.5,
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    renderWhitespace: 'selection',
    wordWrap: 'on',
    fixedOverflowWidgets: true,
    readOnly: props.readonly,
  })
  editor.value = instance
  instance.onDidChangeModelContent(() => {
    const value = instance.getValue()
    if (value !== props.modelValue) emit('update:modelValue', value)
  })
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  applyMarkers()
})

watch(
  () => props.modelValue,
  (value) => {
    const instance = editor.value
    if (instance && instance.getValue() !== value) instance.setValue(value)
  },
)

watch(() => [props.errors, props.warnings], applyMarkers, { deep: true })

watch(
  () => props.readonly,
  (value) => editor.value?.updateOptions({ readOnly: value }),
)

onBeforeUnmount(() => {
  editor.value?.dispose()
  editor.value = null
})

// --- 字段/片段插入（右侧快捷面板用） ---

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function indentWidth(text: string): number {
  return (text.match(/^\s*/) || [''])[0].length
}

/** 顶层键（行首无缩进）所在行，找不到返回 0 */
function findTopLevel(key: string): number {
  const model = editor.value?.getModel()
  if (!model) return 0
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`)
  for (let line = 1; line <= model.getLineCount(); line += 1) {
    if (pattern.test(model.getLineContent(line))) return line
  }
  return 0
}

function focusLine(line: number, selectValue = false): void {
  const instance = editor.value
  const model = instance?.getModel()
  if (!instance || !model) return
  const text = model.getLineContent(line)
  const maxColumn = model.getLineMaxColumn(line)
  const colon = text.indexOf(':')
  const startColumn = selectValue && colon >= 0 ? Math.min(colon + 2, maxColumn) : maxColumn
  instance.setSelection(new monaco.Selection(line, startColumn, line, maxColumn))
  instance.revealLineInCenter(line)
  instance.focus()
}

/** 在 line 行下方插入若干行 */
function insertAfter(line: number, lines: string[]): number {
  const instance = editor.value
  const model = instance?.getModel()
  if (!instance || !model) return 0
  const column = model.getLineMaxColumn(line)
  instance.pushUndoStop()
  instance.executeEdits('case-palette', [
    { range: new monaco.Range(line, column, line, column), text: `\n${lines.join('\n')}` },
  ])
  instance.pushUndoStop()
  focusLine(line + 1)
  return line + 1
}

/** 追加到文末（补一个换行，保持文档以换行结尾） */
function appendAtEnd(lines: string[]): number {
  const instance = editor.value
  const model = instance?.getModel()
  if (!instance || !model) return 0
  const value = model.getValue()
  const lastLine = model.getLineCount()
  const column = model.getLineMaxColumn(lastLine)
  const prefix = !value || value.endsWith('\n') ? '' : '\n'
  instance.pushUndoStop()
  instance.executeEdits('case-palette', [
    { range: new monaco.Range(lastLine, column, lastLine, column), text: `${prefix}${lines.join('\n')}\n` },
  ])
  instance.pushUndoStop()
  const first = lastLine + (prefix ? 1 : 0)
  focusLine(first)
  return first
}

/** 最后一个步骤（`- goal:`）所在行 */
function findLastStep(stepPattern: RegExp): number {
  const model = editor.value?.getModel()
  if (!model) return 0
  let stepLine = 0
  for (let line = 1; line <= model.getLineCount(); line += 1) {
    if (stepPattern.test(model.getLineContent(line))) stepLine = line
  }
  return stepLine
}

defineExpose({
  revealLine(line: number) {
    const instance = editor.value
    if (!instance || !line) return
    instance.revealLineInCenter(line)
    instance.setPosition({ lineNumber: line, column: 1 })
    instance.focus()
  },
  getValue() {
    return editor.value?.getValue() ?? props.modelValue
  },
  /** 唯一字段：已有同名字段 → 跳到该行并选中值；没有 → 追加到末尾 */
  upsertField(key: string, snippet: string): 'located' | 'appended' {
    const line = findTopLevel(key)
    if (line) {
      focusLine(line, true)
      return 'located'
    }
    appendAtEnd(snippet.split('\n'))
    return 'appended'
  },
  /** 可重复内容（步骤等）：一律追加到末尾，不去定位已有条目 */
  appendSnippet(lines: string[]): void {
    appendAtEnd(lines)
  },
  /** 块键（如 steps:）下第一行列表项的缩进，让追加的片段跟文档既有风格一致 */
  listIndent(key: string): number {
    const model = editor.value?.getModel()
    if (!model) return 0
    const line = findTopLevel(key)
    if (!line) return 0
    const keyIndent = indentWidth(model.getLineContent(line))
    for (let next = line + 1; next <= model.getLineCount(); next += 1) {
      const text = model.getLineContent(next)
      if (!text.trim()) continue
      const dash = text.match(/^(\s*)-\s/)
      return dash ? dash[1].length : keyIndent + 2
    }
    return keyIndent + 2
  },
  /** 往最后一个步骤的 checks 里追加一条断言（可重复，永远追加） */
  appendCheck(body: string): boolean {
    const model = editor.value?.getModel()
    if (!model) return false
    const count = model.getLineCount()
    const stepPattern = /^\s*-\s*goal\s*:/
    const stepLine = findLastStep(stepPattern)
    if (!stepLine) return false
    let checksLine = 0
    for (let line = stepLine + 1; line <= count; line += 1) {
      const text = model.getLineContent(line)
      if (stepPattern.test(text)) break
      if (/^\s*checks\s*:/.test(text)) checksLine = line
    }
    if (!checksLine) {
      const pad = ' '.repeat(indentWidth(model.getLineContent(stepLine)) + 2)
      insertAfter(stepLine, [`${pad}checks:`, `${pad}- ${body}`])
      return true
    }
    const base = indentWidth(model.getLineContent(checksLine))
    let end = checksLine
    let itemIndent = base
    for (let line = checksLine + 1; line <= count; line += 1) {
      const text = model.getLineContent(line)
      if (!text.trim()) continue
      if (stepPattern.test(text)) break
      const indent = indentWidth(text)
      // 同缩进的 `- xxx` 是 checks 的条目（YAML 允许序列与键同缩进），缩进更深的也算
      if (indent < base || (indent === base && !/^\s*-\s/.test(text))) break
      end = line
      itemIndent = indent
    }
    insertAfter(end, [`${' '.repeat(itemIndent)}- ${body}`])
    return true
  },
})
</script>

<template>
  <div class="yaml-editor-root">
    <div ref="host" class="yaml-editor-host" />
  </div>
</template>

<style scoped>
.yaml-editor-root {
  position: relative;
  flex: 1 1 auto;
  min-height: 380px;
}

/* Monaco 是拿容器实测尺寸来布局的：外层高度不确定时 height:100% 会解析成 auto，
   编辑器就缩成一条线。所以内层用绝对定位，尺寸钉在外层（position: relative）上。 */
.yaml-editor-host {
  position: absolute;
  inset: 0;
}
</style>
