<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { envApi } from '@/api'
import type { Env, PageRow } from '@/api/types'
import ProbeButton from '@/components/ProbeButton.vue'
import { useUiStore } from '@/stores/ui'
import { formatDateTime, formatTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const ui = useUiStore()

const envs = ref<Env[]>([])
const selectedId = ref<number | null>(null)
const loading = ref(false)
const activeTab = ref('config')

const pages = ref<PageRow[]>([])
const pagesLoading = ref(false)

const createVisible = ref(false)
const saving = ref(false)

const form = ref({ name: '', label: '', base_url: '', auth: 'unknown', timeout_ms: 30000, note: '' })
const secretInput = ref<Record<string, string>>({})
const newKey = ref('')
const baseUrlInput = ref('')

const SECRET_HINT = '用例里在 vars 槽位用 ${{secret.键名}} 引用，例如 vars: { 账号: "${{secret.STAGING_ACCOUNT}}" }；保存与运行时由服务端替换成真实值。'

const selected = computed(() => envs.value.find((item) => item.id === selectedId.value) || null)

async function load(keepSelection = true): Promise<void> {
  loading.value = true
  try {
    const data = await envApi.list()
    envs.value = data.items
    if (!keepSelection || selectedId.value === null || !envs.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = envs.value[0]?.id ?? null
    }
    await ui.loadEnvs()
    syncForm()
    if (activeTab.value === 'pages') void loadPages()
  } catch (error) {
    showApiError(error, '取环境列表失败')
  } finally {
    loading.value = false
  }
}

function syncForm(): void {
  const env = selected.value
  if (!env) return
  form.value = {
    name: env.name,
    label: env.label,
    base_url: env.base_url,
    auth: env.auth,
    timeout_ms: env.timeout_ms,
    note: env.note,
  }
  baseUrlInput.value = ''
  secretInput.value = {}
  newKey.value = ''
}

function selectEnv(id: number): void {
  selectedId.value = id
  activeTab.value = 'config'
  syncForm()
}

async function saveConfig(): Promise<void> {
  const env = selected.value
  if (!env) return
  saving.value = true
  try {
    await envApi.update(env.id, {
      label: form.value.label,
      base_url: form.value.base_url,
      auth: form.value.auth,
      timeout_ms: Number(form.value.timeout_ms) || 30000,
      note: form.value.note,
    })
    ElMessage.success('已保存（密钥请在『密钥』页签单独写）')
    await load()
  } catch (error) {
    showApiError(error, '保存失败')
  } finally {
    saving.value = false
  }
}

async function createEnv(): Promise<void> {
  if (!form.value.name.trim()) {
    ElMessage.warning('环境名必填（英文代号，如 staging）')
    return
  }
  saving.value = true
  try {
    const created = await envApi.create({
      name: form.value.name.trim(),
      label: form.value.label,
      base_url: form.value.base_url,
      auth: form.value.auth,
      timeout_ms: Number(form.value.timeout_ms) || 30000,
      note: form.value.note,
      secret_keys: [],
    })
    createVisible.value = false
    await load(false)
    selectedId.value = created.id
    syncForm()
    ElMessage.success('已新建环境')
  } catch (error) {
    showApiError(error, '新建环境失败')
  } finally {
    saving.value = false
  }
}

function openCreate(): void {
  form.value = { name: '', label: '', base_url: '', auth: 'unknown', timeout_ms: 30000, note: '' }
  createVisible.value = true
}

async function saveSecrets(): Promise<void> {
  const env = selected.value
  if (!env) return
  const secrets: Record<string, string> = {}
  for (const [key, value] of Object.entries(secretInput.value)) {
    if (value) secrets[key] = value
  }
  if (!baseUrlInput.value && !Object.keys(secrets).length) {
    ElMessage.warning('至少填 base_url 或一个密钥值')
    return
  }
  try {
    await envApi.putSecrets(env.id, {
      ...(baseUrlInput.value ? { base_url: baseUrlInput.value } : {}),
      secrets,
    })
    ElMessage.success('已写入本地密钥文件（只写不读，页面不会回显）')
    secretInput.value = {}
    baseUrlInput.value = ''
    await load()
  } catch (error) {
    showApiError(error, '写密钥失败')
  }
}

function addKey(): void {
  const key = newKey.value.trim()
  if (!key) return
  // 与内核 ${{secret.键名}} 的取值同界：不能含空白与 = { } ,（逗号用于 --secret-keys 列表）；
  // / 和 \ 也不能有——删除接口把它们当路径分隔符
  if (!/^[^\s={},\/\\]+$/.test(key)) {
    ElMessage.warning('键名不能含空格和 = { } , / \\ 这几种字符，例如 STAGING_PASSWORD、账号')
    return
  }
  secretInput.value = { ...secretInput.value, [key]: '' }
  newKey.value = ''
}

function keyKeys(): string[] {
  const declared = (selected.value?.secret_keys || []).map((item) => item.key)
  return [...new Set([...declared, ...Object.keys(secretInput.value)])]
}

function isDeclared(key: string): boolean {
  return (selected.value?.secret_keys || []).some((item) => item.key === key)
}

async function removeSecret(key: string): Promise<void> {
  const env = selected.value
  if (!env) return
  if (!isDeclared(key)) {
    // 只是页面上的草稿行，还没落库，直接拿掉
    const next = { ...secretInput.value }
    delete next[key]
    secretInput.value = next
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除密钥「${key}」？（服务器本地文件与键名列表一起移除；用例里引用它的地方运行时会缺值）`,
      '删除密钥',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await envApi.delSecret(env.id, key)
    env.secret_keys = env.secret_keys.filter((item) => item.key !== key)
    const next = { ...secretInput.value }
    delete next[key]
    secretInput.value = next
    ElMessage.success(`已删除密钥「${key}」`)
  } catch (error) {
    showApiError(error, '删除密钥失败')
  }
}

async function loadPages(): Promise<void> {
  const env = selected.value
  if (!env) return
  pagesLoading.value = true
  try {
    const data = await envApi.pages(env.id)
    pages.value = data.items
  } catch (error) {
    showApiError(error, '取页清单失败')
  } finally {
    pagesLoading.value = false
  }
}

async function removeEnv(): Promise<void> {
  const env = selected.value
  if (!env) return
  try {
    await ElMessageBox.confirm(`删除环境「${env.name}」？（有场景默认用它、或有运行记录引用时会被拒绝）`, '二次确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await envApi.remove(env.id)
    selectedId.value = null
    await load(false)
    ElMessage.success('已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除失败')
  }
}

onMounted(() => void load(false))
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="crumb">
      <b>环境管理</b>
      <span class="muted" style="margin-left: 8px">地址与密钥由服务端保存；密钥只写不读，页面只显示「已设置」</span>
    </div>

    <div style="display: flex; gap: 12px; align-items: flex-start">
      <div style="width: 320px; flex: none">
        <div class="cards" style="flex-direction: column; gap: 8px">
          <el-card
            v-for="env in envs"
            :key="env.id"
            shadow="hover"
            :class="{ 'env-off': !env.configured }"
            style="cursor: pointer"
            :style="{ borderColor: env.id === selectedId ? '#409eff' : '' }"
            body-style="padding: 10px 12px"
            @click="selectEnv(env.id)"
          >
            <div style="display: flex; align-items: center; gap: 6px">
              <b>{{ env.label || env.name }}</b>
              <span class="muted">{{ env.name }}</span>
              <el-tag v-if="!env.configured" size="small" type="warning" disable-transitions>未配地址</el-tag>
            </div>
            <div class="muted mono" style="margin-top: 4px">{{ env.base_url || '（未设置 base_url）' }}</div>
            <div class="muted" style="margin-top: 4px">
              密钥 {{ env.secret_keys.filter((item) => item.set).length }}/{{ env.secret_keys.length }} 已设置 ·
              {{ env.last_probe ? `探针 ${formatTime(env.last_probe.at)}` : '未探针' }}
            </div>
          </el-card>
          <el-card v-if="!envs.length" body-style="padding: 12px">
            <div class="muted">还没有环境。点右上「+ 新建环境」。</div>
          </el-card>
        </div>
        <el-button size="small" type="primary" style="margin-top: 4px" @click="openCreate()">+ 新建环境</el-button>
      </div>

      <el-card v-if="selected" style="flex: 1; min-width: 0">
        <template #header>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <b>{{ selected.label || selected.name }}</b>
            <span class="muted">{{ selected.name }}</span>
            <el-tag v-if="selected.auth !== 'unknown'" size="small" type="info" disable-transitions>
              {{ selected.auth === 'login_form' ? '登录表单' : '免登录' }}
            </el-tag>
            <span class="muted">超时 {{ selected.timeout_ms }}ms · 更新 {{ formatDateTime(selected.updated_at) }}</span>
            <div style="flex: 1" />
            <ProbeButton :env-id="selected.id" :env-name="selected.name" />
            <el-button size="small" @click="ui.setEnv(selected.id)">
              {{ ui.envId === selected.id ? '当前环境' : '设为当前' }}
            </el-button>
            <el-button size="small" type="danger" text @click="removeEnv()">删除</el-button>
          </div>
        </template>

        <el-tabs v-model="activeTab" @tab-change="(name: string) => name === 'pages' && loadPages()">
          <el-tab-pane label="配置" name="config">
            <el-form label-width="96px" style="max-width: 640px" @submit.prevent>
              <el-form-item label="代号">
                <el-input v-model="form.name" disabled />
              </el-form-item>
              <el-form-item label="名称">
                <el-input v-model="form.label" placeholder="展示名，如 预发环境" />
              </el-form-item>
              <el-form-item label="base_url">
                <el-input v-model="form.base_url" placeholder="https://…（运行时的起始地址，环境注入）" />
              </el-form-item>
              <el-form-item label="登录形态">
                <el-radio-group v-model="form.auth">
                  <el-radio value="unknown">未知</el-radio>
                  <el-radio value="none">免登录</el-radio>
                  <el-radio value="login_form">登录表单</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="超时(ms)">
                <el-input v-model="form.timeout_ms" type="number" style="width: 160px" />
              </el-form-item>
              <el-form-item label="备注">
                <el-input v-model="form.note" type="textarea" :rows="2" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="saving" @click="saveConfig()">保存配置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="密钥（只写）" name="secrets">
            <el-alert
              type="info"
              :closable="false"
              style="margin-bottom: 10px"
              title="密钥写在服务器本地文件（secrets/<env>.local.yaml，gitignore）；接口不回显值，只回键名与是否已设置。"
            />
            <el-form label-width="120px" style="max-width: 640px" @submit.prevent>
              <el-form-item label="base_url 覆盖">
                <el-input v-model="baseUrlInput" :placeholder="selected.base_url || '留空表示不改'" />
              </el-form-item>
              <el-form-item v-for="key in keyKeys()" :key="key" :label="key">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%">
                  <el-input
                    v-model="secretInput[key]"
                    type="password"
                    show-password
                    style="flex: 1; min-width: 0"
                    :placeholder="selected.secret_keys.find((item) => item.key === key)?.set ? '已设置（留空表示不改）' : '未设置'"
                  />
                  <el-tag v-if="!isDeclared(key)" size="small" type="info" disable-transitions>未写入</el-tag>
                  <el-button
                    size="small"
                    text
                    :type="isDeclared(key) ? 'danger' : 'info'"
                    :title="isDeclared(key) ? '从服务器本地文件与键名列表移除' : '只是清掉这一行草稿，不在服务器上'"
                    @click="removeSecret(key)"
                  >
                    {{ isDeclared(key) ? '删除' : '移除' }}
                  </el-button>
                </div>
              </el-form-item>
              <el-form-item label="新增键名">
                <el-input v-model="newKey" placeholder="如 STAGING_PASSWORD" style="width: 240px" @keyup.enter="addKey" />
                <el-button style="margin-left: 8px" @click="addKey()">加一行</el-button>
                <span class="muted" style="margin-left: 10px">「加一行」只是排在页面上；填上值、点「写入密钥」才会落库</span>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveSecrets()">写入密钥</el-button>
                <span class="muted" style="margin-left: 10px">{{ SECRET_HINT }}</span>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="页清单" name="pages">
            <el-table v-loading="pagesLoading" :data="pages" size="small" empty-text="还没有访问记录（跑一次用例或点探针）">
              <el-table-column prop="url" label="地址" min-width="300" />
              <el-table-column prop="title" label="标题" min-width="160" />
              <el-table-column label="需登录" width="90">
                <template #default="{ row }">
                  {{ row.needs_login === null ? '未知' : row.needs_login ? '是' : '否' }}
                </template>
              </el-table-column>
              <el-table-column label="最近访问" width="150">
                <template #default="{ row }"><span class="muted">{{ formatDateTime(row.last_seen) }}</span></template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
      <el-card v-else style="flex: 1">
        <div class="empty-block">左边选一个环境，或新建一个</div>
      </el-card>
    </div>

    <el-dialog v-model="createVisible" title="新建环境" width="520px">
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="代号" required>
          <el-input v-model="form.name" placeholder="英文代号，如 staging（用例不会看到它）" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.label" placeholder="展示名" />
        </el-form-item>
        <el-form-item label="base_url">
          <el-input v-model="form.base_url" placeholder="可先留空，之后在『密钥』页签写" />
        </el-form-item>
        <el-form-item label="登录形态">
          <el-radio-group v-model="form.auth">
            <el-radio value="unknown">未知</el-radio>
            <el-radio value="none">免登录</el-radio>
            <el-radio value="login_form">登录表单</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createEnv()">新建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.env-off {
  opacity: 0.72;
}
</style>
