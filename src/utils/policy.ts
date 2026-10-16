import type { RunPolicy } from '@/api/types'

/** 老台账没有策略快照（空对象）时按默认「全开」对待，与后端 execute() 的兜底一致。 */
export function policyOf(raw: Partial<RunPolicy> | null | undefined): RunPolicy {
  const decider = raw?.decider === 'llm' || raw?.decider === 'off' ? raw.decider : 'jev'
  return {
    decider,
    supervisor: raw?.supervisor ?? true,
    cache: raw?.cache ?? true,
    cache_strict: raw?.cache_strict ?? false,
  }
}

/** 档位短标签（台账列/运行头）：四档（全开/只开 Jev/只开大模型/零模型）+ 缓存与严判缀语。 */
export function policyLabel(raw: Partial<RunPolicy> | null | undefined): string {
  const p = policyOf(raw)
  const base =
    p.decider === 'jev'
      ? p.supervisor
        ? '全开'
        : '只开 Jev'
      : p.decider === 'llm'
        ? '只开大模型'
        : '零模型'
  const extras: string[] = []
  if (!p.cache) extras.push('缓存关')
  if (p.cache_strict) extras.push('严判')
  return extras.length ? `${base}·${extras.join('·')}` : base
}

/** 展开细节（tooltip）：每个开关的落地效果。 */
export function policyDetail(raw: Partial<RunPolicy> | null | undefined): string {
  const p = policyOf(raw)
  const model =
    p.decider === 'jev' ? 'Jev 决策每步' : p.decider === 'llm' ? '大模型代 Jev 决策' : '无决策模型'
  const supervisor = p.supervisor ? '阻断升级大模型监督' : '阻断直接停'
  const cache = p.cache ? '回放开' : '回放关'
  const strict = p.cache_strict ? ' · 严判（状态签名须一致）' : ''
  return `${model} · ${supervisor} · ${cache}${strict}`
}
