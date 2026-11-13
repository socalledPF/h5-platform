<script setup lang="ts">
import { BridgeError, CODE, invoke } from '@h5/bridge'
import { ref } from 'vue'

import { CODE_HINTS, CODE_LABELS } from '../bridge/catalog'
import type { MethodEntry } from '../bridge/catalog'

const props = defineProps<{
  entry: MethodEntry
  supported: boolean
}>()

interface CallResult {
  ok: boolean
  code: number
  label: string
  durationMs: number
  data?: unknown
  msg?: string
  hint?: string
}

const paramsText = ref(props.entry.paramsJson)
const result = ref<CallResult | null>(null)
const calling = ref(false)

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseParams(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(paramsText.value.trim() === '' ? '{}' : paramsText.value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('params 必须是 JSON 对象，例如 {"key":"value"}')
  }
  return parsed as Record<string, unknown>
}

/** 调用一次 Bridge 方法，把 code / data / msg 或 BridgeError 的码与方法名都展示出来。 */
async function call(): Promise<void> {
  if (calling.value) return

  let params: Record<string, unknown>
  try {
    params = parseParams()
  } catch (error) {
    result.value = {
      ok: false,
      code: CODE.BAD_PARAMS,
      label: '参数不是合法的 JSON 对象（本地拦截，未发往原生）',
      durationMs: 0,
      msg: error instanceof Error ? error.message : String(error),
    }
    return
  }

  calling.value = true
  const startedAt = performance.now()
  try {
    const data = await invoke<unknown>(props.entry.method, params)
    result.value = {
      ok: true,
      code: CODE.OK,
      label: CODE_LABELS[CODE.OK],
      durationMs: Math.round(performance.now() - startedAt),
      data,
    }
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : CODE.BAD_PARAMS
    result.value = {
      ok: false,
      code,
      label: CODE_LABELS[code] ?? `${code} · 未在协议文档中登记`,
      durationMs: Math.round(performance.now() - startedAt),
      msg: error instanceof Error ? error.message : String(error),
      hint: CODE_HINTS[code],
    }
  } finally {
    calling.value = false
  }
}
</script>

<template>
  <article class="method" :data-testid="`method-${entry.method}`">
    <header class="method__head">
      <code class="method__name">{{ entry.method }}</code>
      <span class="method__support" :class="supported ? 'is-on' : 'is-off'">
        {{ supported ? 'canIUse: 支持' : 'canIUse: 未支持' }}
      </span>
    </header>

    <label class="method__label" :for="`params-${entry.method}`">params (JSON)</label>
    <textarea
      :id="`params-${entry.method}`"
      v-model="paramsText"
      class="method__params"
      rows="3"
      spellcheck="false"
      :data-testid="`params-${entry.method}`"
    />

    <div class="method__actions">
      <van-button
        size="small"
        type="primary"
        :loading="calling"
        :data-testid="`call-${entry.method}`"
        @click="call"
      >
        调用
      </van-button>
    </div>

    <div v-if="result !== null" class="method__result" :class="result.ok ? 'is-ok' : 'is-fail'">
      <p class="method__code" :data-testid="`code-${entry.method}`">
        {{ result.ok ? 'code 0' : `code ${result.code}` }} · {{ result.label }} ·
        {{ result.durationMs }}ms
      </p>
      <p v-if="result.msg !== undefined" class="method__msg">msg: {{ result.msg }}</p>
      <p v-if="result.hint !== undefined" class="method__hint">{{ result.hint }}</p>
      <pre class="method__data">{{ result.ok ? stringify(result.data) : 'data: (无)' }}</pre>
    </div>
  </article>
</template>

<style scoped>
.method {
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.method__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.method__name {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.method__support {
  flex: 0 0 auto;
  font-size: var(--font-size-xs);
}

.method__support.is-on {
  color: var(--color-success);
}

.method__support.is-off {
  color: var(--color-text-placeholder);
}

.method__label {
  display: block;
  margin-top: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.method__params {
  box-sizing: border-box;
  width: 100%;
  margin-top: var(--space-xs);
  padding: var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: ui-monospace, sfmono-regular, menlo, monospace;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  background-color: var(--color-bg-page);
  resize: vertical;
}

.method__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.method__result {
  padding: var(--space-sm);
  margin-top: var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}

.method__result.is-ok {
  color: var(--color-success);
  background-color: var(--color-bg-page);
}

.method__result.is-fail {
  color: var(--color-danger);
  background-color: var(--color-bg-page);
}

.method__code {
  font-weight: 600;
}

.method__msg,
.method__hint {
  margin-top: var(--space-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.method__data {
  margin-top: var(--space-xs);
  overflow-x: auto;
  color: var(--color-text);
  font-family: ui-monospace, sfmono-regular, menlo, monospace;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
