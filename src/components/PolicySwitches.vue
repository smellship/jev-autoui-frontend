<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { settingsApi } from '@/api'
import type { RunPolicy } from '@/api/types'
import { showApiError } from '@/utils/notify'
import { policyLabel } from '@/utils/policy'

/** 顶栏四开关（仅管理员渲染）：两个模型开关 + 回放缓存 + 严判，落盘后对之后新发起的运行生效。 */
const policy = ref<RunPolicy | null>(null)
const loaded = ref(false)
const saving = ref(false)
let queued = false
let editSeq = 0

// 开关的本地态：改一下存一次；失败回读服务端纠正
const local = reactive({ jev: true, llm: true, cache: true, strict: false })

function adopt(p: RunPolicy): void {
  policy.value = p
  local.jev = p.decider === 'jev'
  local.llm = p.supervisor
  local.cache = p.cache
  local.strict = p.cache_strict
}

async function load(): Promise<void> {
  try {
    adopt((await settingsApi.policy()).policy)
  } catch (error) {
    showApiError(error, '运行策略读取失败')
  } finally {
    loaded.value = true
  }
}

/** 开关变化入口：记一次编辑代次，再走保存（连点合并 + 响应不乱盖新编辑）。 */
function onToggle(): void {
  editSeq += 1
  void apply()
}

async function apply(): Promise<void> {
  // 连点合并：保存中又变了 → 记一笔，收尾时按最新本地态再存一次
  if (saving.value) {
    queued = true
    return
  }
  saving.value = true
  const seqAtSend = editSeq
  try {
    const resp = await settingsApi.savePolicy({
      decider: local.jev ? 'jev' : local.llm ? 'llm' : 'off',
      supervisor: local.llm,
      cache: local.cache,
      cache_strict: local.strict,
    })
    // 请求期间又有新编辑 → 别拿旧响应盖掉，交给随后的合并保存
    if (editSeq === seqAtSend) adopt(resp.policy)
  } catch (error) {
    showApiError(error, '运行策略保存失败')
    if (editSeq === seqAtSend && policy.value) adopt(policy.value)
  } finally {
    saving.value = false
    if (queued) {
      queued = false
      void apply()
    }
  }
}

const tier = computed(() =>
  local.jev && local.llm
    ? '全开（Jev 决策 + 大模型监督）'
    : local.jev
      ? '只开 Jev（阻断直接停）'
      : local.llm
        ? '只开大模型（代 Jev 决策 + 阻断升级）'
        : '全关（只跑零模型回放，没有录像直接停）',
)

const chip = computed(() =>
  policyLabel({
    decider: local.jev ? 'jev' : local.llm ? 'llm' : 'off',
    supervisor: local.llm,
    cache: local.cache,
    cache_strict: local.strict,
  }),
)

const jevTip = computed(() =>
  local.llm
    ? 'Jev：每步动作由 Jev 模型决策（关＝改由大模型代班）'
    : 'Jev：每步动作由 Jev 模型决策（关＝没有决策模型，只跑零模型回放）',
)
const llmTip = computed(() =>
  local.jev
    ? '大模型：遇阻断时升级为正常的大模型思考判断（监督）'
    : '大模型：代 Jev 决策每步动作、不开思考；遇阻断升级为正常思考判断',
)
const cacheTip = '回放缓存：优先零模型回放已验收的录像（没有录像且模型全关时直接停）；关＝每次都由模型现场决策'
const strictTip = computed(() =>
  local.cache
    ? '严判：回放命中的录像还须页面状态签名一致，页面结构一变就按失配交还（更保险、更容易失配）'
    : '严判：回放缓存关闭时不生效；开启后回放命中的录像须页面状态签名一致',
)

onMounted(load)
</script>

<template>
  <span v-if="loaded" class="policy">
    <el-tooltip placement="bottom" :content="`当前档位：${tier}。改动对之后新发起的运行生效（已在跑/排队的按提交时的快照执行）`">
      <span class="muted">策略</span>
    </el-tooltip>
    <el-tooltip placement="bottom" :content="jevTip">
      <span class="sw">
        <span>Jev</span>
        <el-switch v-model="local.jev" size="small" :disabled="saving" @change="onToggle" />
      </span>
    </el-tooltip>
    <el-tooltip placement="bottom" :content="llmTip">
      <span class="sw">
        <span>大模型</span>
        <el-switch v-model="local.llm" size="small" :disabled="saving" @change="onToggle" />
      </span>
    </el-tooltip>
    <el-tooltip placement="bottom" :content="cacheTip">
      <span class="sw">
        <span>回放</span>
        <el-switch v-model="local.cache" size="small" :disabled="saving" @change="onToggle" />
      </span>
    </el-tooltip>
    <el-tooltip placement="bottom" :content="strictTip">
      <span class="sw">
        <span>严判</span>
        <el-switch v-model="local.strict" size="small" :disabled="saving || !local.cache" @change="onToggle" />
      </span>
    </el-tooltip>
    <span class="muted chip">{{ chip }}</span>
  </span>
</template>

<style scoped>
.policy {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sw {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #606266;
  font-size: 12px;
  cursor: default;
  white-space: nowrap;
}

.chip {
  font-size: 12px;
  white-space: nowrap;
}
</style>
