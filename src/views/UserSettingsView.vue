<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { authApi, settingsApi, userApi } from '@/api'
import type { ModelKeyStatus, User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const auth = useAuthStore()

const name = ref('')
const savingName = ref(false)

const pwd = ref({ old: '', next: '', confirm: '' })
const savingPwd = ref(false)

const users = ref<User[]>([])
const loadingUsers = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const createForm = ref({ account: '', name: '', password: '' })

const modelKeys = ref<ModelKeyStatus[]>([])
const keyDrafts = ref<Record<string, string>>({})
const loadingKeys = ref(false)
const savingKeys = ref(false)

watch(
  () => auth.user?.name,
  (value) => (name.value = value || ''),
  { immediate: true },
)

async function saveName(): Promise<void> {
  const value = name.value.trim()
  if (!value) {
    ElMessage.warning('昵称不能为空')
    return
  }
  savingName.value = true
  try {
    await auth.updateName(value)
    ElMessage.success('昵称已保存')
    await loadUsers()
  } catch (error) {
    showApiError(error, '保存昵称失败')
  } finally {
    savingName.value = false
  }
}

async function savePassword(): Promise<void> {
  if (!pwd.value.old) {
    ElMessage.warning('请先填原密码')
    return
  }
  if (pwd.value.next.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (pwd.value.next !== pwd.value.confirm) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  savingPwd.value = true
  try {
    await authApi.changePassword(pwd.value.old, pwd.value.next)
    pwd.value = { old: '', next: '', confirm: '' }
    ElMessage.success('密码已修改，下次登录用新密码')
  } catch (error) {
    showApiError(error, '修改密码失败')
  } finally {
    savingPwd.value = false
  }
}

async function loadUsers(): Promise<void> {
  if (!auth.isAdmin) return
  loadingUsers.value = true
  try {
    users.value = (await userApi.list()).items
  } catch (error) {
    showApiError(error, '取用户列表失败')
  } finally {
    loadingUsers.value = false
  }
}

function openCreate(): void {
  createForm.value = { account: '', name: '', password: '' }
  createVisible.value = true
}

async function createUser(): Promise<void> {
  const account = createForm.value.account.trim()
  if (account.length < 2) {
    ElMessage.warning('账号至少 2 位、不能含空白')
    return
  }
  if (createForm.value.password.length < 6) {
    ElMessage.warning('初始密码至少 6 位')
    return
  }
  creating.value = true
  try {
    await userApi.create({
      account,
      name: createForm.value.name.trim(),
      password: createForm.value.password,
    })
    createVisible.value = false
    ElMessage.success(`已新建账号 ${account}`)
    await loadUsers()
  } catch (error) {
    showApiError(error, '新建用户失败')
  } finally {
    creating.value = false
  }
}

async function renameUser(row: User): Promise<void> {
  let value = ''
  try {
    const result = await ElMessageBox.prompt('新的昵称', `改「${row.account}」的昵称`, {
      inputValue: row.name,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '昵称不能为空',
    })
    value = result.value.trim()
  } catch {
    return
  }
  try {
    await userApi.update(row.id, { name: value })
    ElMessage.success('昵称已改')
    await loadUsers()
  } catch (error) {
    showApiError(error, '改昵称失败')
  }
}

async function resetPassword(row: User): Promise<void> {
  let value = ''
  try {
    const result = await ElMessageBox.prompt(
      `给「${row.account}」设一个新的登录密码（对方登录后请自行修改），至少 6 位。`,
      '重置密码',
      { inputType: 'password', inputValidator: (text: string) => text.length >= 6 || '至少 6 位' },
    )
    value = result.value
  } catch {
    return
  }
  try {
    await userApi.resetPassword(row.id, value)
    ElMessage.success(`已重置 ${row.account} 的密码`)
  } catch (error) {
    showApiError(error, '重置密码失败')
  }
}

async function toggleActive(row: User): Promise<void> {
  const next = !row.active
  try {
    await ElMessageBox.confirm(
      next ? `启用「${row.account}」？启用后就能正常登录。` : `停用「${row.account}」？停用后立即无法登录（已签发的 token 也会失效）。`,
      next ? '启用账号' : '停用账号',
      { type: 'warning', confirmButtonText: next ? '启用' : '停用', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await userApi.update(row.id, { active: next })
    ElMessage.success(next ? '已启用' : '已停用')
    await loadUsers()
  } catch (error) {
    showApiError(error, '改状态失败')
  }
}

async function toggleAdmin(row: User): Promise<void> {
  const next = !row.is_admin
  try {
    await ElMessageBox.confirm(
      next ? `把「${row.account}」提为管理员？管理员能新增/停用账号、重置他人密码。` : `收回「${row.account}」的管理员权限？`,
      next ? '设为管理员' : '取消管理员',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await userApi.update(row.id, { is_admin: next })
    ElMessage.success(next ? '已设为管理员' : '已取消管理员')
    await loadUsers()
  } catch (error) {
    showApiError(error, '改权限失败')
  }
}

async function loadKeys(): Promise<void> {
  if (!auth.isAdmin) return
  loadingKeys.value = true
  try {
    modelKeys.value = (await settingsApi.modelKeys()).items
    keyDrafts.value = Object.fromEntries(modelKeys.value.map((item) => [item.key, '']))
  } catch (error) {
    showApiError(error, '取模型 Key 状态失败')
  } finally {
    loadingKeys.value = false
  }
}

async function saveKeys(): Promise<void> {
  const body: Record<string, string> = {}
  for (const item of modelKeys.value) {
    const value = (keyDrafts.value[item.key] || '').trim()
    if (value) body[item.key] = value
  }
  if (!Object.keys(body).length) {
    ElMessage.warning('输入框都是空的：填一把要保存的 Key，或用行末「清除」移除已设置的')
    return
  }
  savingKeys.value = true
  try {
    const result = await settingsApi.saveModelKeys(body)
    ElMessage.success(result.changed.length ? '已保存，对之后的内核调用生效' : '值与已存的一样，没有变化')
    await loadKeys()
  } catch (error) {
    showApiError(error, '保存模型 Key 失败')
  } finally {
    savingKeys.value = false
  }
}

async function clearKey(item: ModelKeyStatus): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `清除「${item.label}」？清除后内核缺少对应模型的凭据，相关运行会失败，直到重新配置。`,
      '清除模型 Key',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await settingsApi.saveModelKeys({ [item.key]: '' })
    ElMessage.success(`已清除「${item.label}」`)
    await loadKeys()
  } catch (error) {
    showApiError(error, '清除失败')
  }
}

onMounted(() => {
  void loadUsers()
  void loadKeys()
})
</script>

<template>
  <div class="page" style="display: flex; flex-direction: column; gap: 12px; max-width: 1080px">
    <div class="crumb">
      当前登录：<b>{{ auth.displayName }}</b>
      <span class="muted"> · {{ auth.user?.account }}</span>
    </div>

    <el-card>
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px">
          <b>账号信息</b>
          <el-tag v-if="auth.isAdmin" size="small" type="warning" disable-transitions>管理员</el-tag>
          <el-tag v-else size="small" type="info" disable-transitions>普通成员</el-tag>
        </div>
      </template>
      <el-form label-width="96px" style="max-width: 640px" @submit.prevent>
        <el-form-item label="账号">
          <el-input :model-value="auth.user?.account || ''" disabled />
          <span class="muted" style="margin-left: 10px">账号是登录名，建好后不可修改</span>
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="name" style="width: 240px" maxlength="64" placeholder="展示在右上角的名字" />
          <el-button style="margin-left: 8px" type="primary" :loading="savingName" @click="saveName()">
            保存
          </el-button>
        </el-form-item>
        <el-form-item label="角色">
          <span>{{ auth.isAdmin ? '管理员（可管理用户）' : '普通成员（只能用平台功能）' }}</span>
        </el-form-item>
        <el-form-item label="登录密码">
          <span>已设置 <span class="muted">（口令只存哈希，平台不回显任何密码；要换请在下面「修改密码」里改）</span></span>
        </el-form-item>
        <el-form-item label="创建时间">
          <span class="muted">{{ formatDateTime(auth.user?.created_at) }}</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card>
      <template #header><b>修改密码</b></template>
      <el-form label-width="96px" style="max-width: 640px" @submit.prevent>
        <el-form-item label="原密码">
          <el-input v-model="pwd.old" type="password" show-password style="width: 320px" autocomplete="off" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwd.next" type="password" show-password style="width: 320px" autocomplete="off" />
          <span class="muted" style="margin-left: 10px">6–64 位，首尾不能有空白</span>
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="pwd.confirm" type="password" show-password style="width: 320px" autocomplete="off" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingPwd" @click="savePassword()">修改密码</el-button>
          <span class="muted" style="margin-left: 10px">改完当前登录不受影响，下次登录用新密码</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="auth.isAdmin">
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px">
          <b>用户管理</b>
          <span class="muted">共 {{ users.length }} 个账号 · 仅管理员可见</span>
          <div style="flex: 1" />
          <el-button size="small" type="primary" @click="openCreate()">+ 新建用户</el-button>
        </div>
      </template>
      <el-table v-loading="loadingUsers" :data="users" size="small" empty-text="还没有其他账号">
        <el-table-column prop="name" label="昵称" min-width="140" />
        <el-table-column prop="account" label="账号" min-width="140" />
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.is_admin" size="small" type="warning" disable-transitions>管理员</el-tag>
            <el-tag v-else size="small" type="info" disable-transitions>成员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.active ? 'success' : 'danger'" size="small" disable-transitions>
              {{ row.active ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><span class="muted">{{ formatDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="330">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="renameUser(row)">改昵称</el-button>
            <el-button size="small" text type="primary" @click="resetPassword(row)">重置密码</el-button>
            <el-tooltip :disabled="row.id !== auth.user?.id" content="不能停用自己的账号" placement="top">
              <span>
                <el-button
                  size="small"
                  text
                  :type="row.active ? 'danger' : 'success'"
                  :disabled="row.id === auth.user?.id"
                  @click="toggleActive(row)"
                >
                  {{ row.active ? '停用' : '启用' }}
                </el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="row.id !== auth.user?.id" content="不能改自己的管理员标志" placement="top">
              <span>
                <el-button
                  size="small"
                  text
                  :disabled="row.id === auth.user?.id"
                  @click="toggleAdmin(row)"
                >
                  {{ row.is_admin ? '取消管理员' : '设为管理员' }}
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-else body-style="padding: 12px 14px">
      <span class="muted">
        用户管理需要管理员权限：当前账号是普通成员，只能改自己的昵称与密码。要新增账号请找管理员。
      </span>
    </el-card>

    <el-card v-if="auth.isAdmin">
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px">
          <b>模型 API Key</b>
          <span class="muted">内核运行要用的两把 Key · 仅管理员可见</span>
          <div style="flex: 1" />
          <el-button size="small" type="primary" :loading="savingKeys" @click="saveKeys()">保存</el-button>
        </div>
      </template>
      <el-form v-loading="loadingKeys" label-width="150px" style="max-width: 860px" @submit.prevent>
        <el-form-item v-for="item in modelKeys" :key="item.key">
          <template #label>
            <div style="line-height: 1.45">
              <div>{{ item.label }}</div>
              <div class="muted mono" style="font-size: 12px">{{ item.env_name }}</div>
            </div>
          </template>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <el-input
              v-model="keyDrafts[item.key]"
              type="password"
              show-password
              style="width: 300px"
              autocomplete="off"
              :placeholder="item.set ? '已设置（留空表示不改）' : '粘贴 Key 后点右上角保存'"
            />
            <el-tag v-if="item.set" size="small" type="success" disable-transitions>已设置</el-tag>
            <el-tag v-else size="small" type="info" disable-transitions>未设置</el-tag>
            <span v-if="item.source === 'env'" class="muted" style="font-size: 12px">
              来自服务器环境变量，平台上清除不了
            </span>
            <el-button
              v-if="item.source === 'file'"
              size="small"
              text
              type="danger"
              @click="clearKey(item)"
            >
              清除
            </el-button>
          </div>
          <div class="muted" style="font-size: 12px; margin-top: 2px">{{ item.hint }}</div>
        </el-form-item>
      </el-form>
      <div class="muted" style="font-size: 12px">
        值写在服务器本地 secrets/_model_keys.local.yaml（gitignore，只写不读）；接口不回显，只显示「已设置」。
        保存后对之后的内核调用立即生效，不用重启服务。
      </div>
    </el-card>

    <el-dialog v-model="createVisible" title="新建用户" width="520px">
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="账号" required>
          <el-input v-model="createForm.account" placeholder="登录名，2–64 位、不能含空白" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="createForm.name" placeholder="留空则用账号" />
        </el-form-item>
        <el-form-item label="初始密码" required>
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 6 位，交给对方后请其自行修改" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createUser()">新建</el-button>
      </template>
    </el-dialog>
  </div>
</template>
