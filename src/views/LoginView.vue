<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({ account: '', password: '' })
const loading = ref(false)

async function submit(): Promise<void> {
  if (!form.account || !form.password) {
    ElMessage.warning('请输入账号与密码')
    return
  }
  loading.value = true
  try {
    await auth.login(form.account, form.password)
    const next = typeof route.query.next === 'string' ? route.query.next : '/cases'
    await router.replace(next)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div style="display: flex; align-items: center; justify-content: center; height: 100%">
    <el-card style="width: 380px" shadow="always">
      <template #header>
        <div style="font-size: 15px; font-weight: 700; color: #409eff">UI 测试平台</div>
      </template>
      <el-form label-width="60px" @submit.prevent="submit">
        <el-form-item label="账号">
          <el-input v-model="form.account" placeholder="账号" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            show-password
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" style="width: 100%" :loading="loading" @click="submit">登录</el-button>
        </el-form-item>
      </el-form>
      <div class="muted">仅内网使用；密钥只在服务器本地保存，平台不展示明文。</div>
    </el-card>
  </div>
</template>
