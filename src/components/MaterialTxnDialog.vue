<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { TxnType } from '../types'
import { TXN_TYPES, TXN_REASONS } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { toNumber } from '../utils/format'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 预置材料（从某材料行发起记账时传入，不可切换） */
    materialId?: string
    /** 预置流水类型 */
    defaultType?: TxnType
  }>(),
  { materialId: '', defaultType: '入库' },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const store = useMaterialStore()
const formRef = ref<FormInstance>()

const form = reactive<{
  materialId: string
  type: TxnType
  amount: number
  reason: string
  note: string
  happenedAt: Date
}>({
  materialId: '',
  type: '入库',
  amount: 1,
  reason: '',
  note: '',
  happenedAt: new Date(),
})

const rules: FormRules = {
  materialId: [{ required: true, message: '请选择材料', trigger: 'change' }],
  reason: [{ required: true, message: '请选择或填写原因', trigger: 'change' }],
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    form.materialId = props.materialId
    form.type = props.defaultType
    form.amount = 1
    form.reason = TXN_REASONS[props.defaultType][0]
    form.note = ''
    form.happenedAt = new Date()
  },
)

watch(
  () => form.type,
  (t) => {
    // 切换类型时给出该类型的默认原因
    form.reason = TXN_REASONS[t][0]
  },
)

/** 当前结存（供界面提示与领用校验） */
const currentQty = computed(() =>
  form.materialId ? store.currentBalance(form.materialId) : 0,
)
const currentUnit = computed(() => store.getMaterial(form.materialId)?.unit ?? '')

const amountLabel = computed(() => {
  if (form.type === '入库') return '入库数量'
  if (form.type === '领用') return '领用数量'
  return '盘点后库存'
})

const title = computed(() => {
  const map: Record<TxnType, string> = { 入库: '材料入库', 领用: '材料领用', 调整: '盘点调整' }
  return map[form.type]
})

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  const amount = toNumber(form.amount)
  if (form.type !== '调整' && amount <= 0) {
    ElMessage.error('数量必须大于 0')
    return
  }
  if (form.type === '领用' && amount > currentQty.value) {
    ElMessage.error(`库存不足：当前仅 ${currentQty.value} ${currentUnit.value}`)
    return
  }

  try {
    store.recordTransaction(form.materialId, {
      type: form.type,
      amount,
      reason: form.reason,
      note: form.note || undefined,
      happenedAt: form.happenedAt.getTime(),
    })
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '记账失败')
    return
  }

  ElMessage.success('已记账，库存已更新')
  emit('saved')
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="520px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
      <el-form-item label="材料" prop="materialId">
        <el-select
          v-model="form.materialId"
          filterable
          placeholder="选择材料"
          style="width: 100%"
          :disabled="!!materialId"
        >
          <el-option
            v-for="m in store.materials.value"
            :key="m.id"
            :label="`${m.name}（${m.category}）`"
            :value="m.id"
          >
            <span>{{ m.name }}</span>
            <span class="muted" style="float: right">结存 {{ m.quantity }} {{ m.unit }}</span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item label="类型">
        <el-radio-group v-model="form.type">
          <el-radio-button v-for="t in TXN_TYPES" :key="t" :value="t">{{ t }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="form.materialId" label="当前结存">
        <span class="muted">
          {{ currentQty }} {{ currentUnit }}
          <template v-if="form.type === '调整'">
            → 调整后为 <strong>{{ toNumber(form.amount) }}</strong> {{ currentUnit }}
            （{{ toNumber(form.amount) - currentQty >= 0 ? '+' : '' }}{{ toNumber(form.amount) - currentQty }}）
          </template>
        </span>
      </el-form-item>

      <el-form-item :label="amountLabel">
        <el-input-number v-model="form.amount" :min="0" :step="1" />
        <span class="muted" style="margin-left: 8px">{{ currentUnit }}</span>
      </el-form-item>

      <el-form-item label="原因" prop="reason">
        <el-select
          v-model="form.reason"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入原因"
          style="width: 100%"
        >
          <el-option v-for="r in TXN_REASONS[form.type]" :key="r" :label="r" :value="r" />
        </el-select>
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="2"
          placeholder="可选：补充说明（如供应商、领用人/项目、盘点差异原因等）"
        />
      </el-form-item>

      <el-form-item label="发生时间">
        <el-date-picker
          v-model="form.happenedAt"
          type="datetime"
          placeholder="选择时间"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submit">记账</el-button>
    </template>
  </el-dialog>
</template>
