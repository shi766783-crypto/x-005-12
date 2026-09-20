<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { StockTxnType } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { toNumber } from '../utils/format'

const props = defineProps<{
  modelValue: boolean
  type: StockTxnType
  materialId: string | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const store = useMaterialStore()
const formRef = ref<FormInstance>()

const form = reactive({
  qty: 1, // 入库/领用：变化数量；盘点调整：实盘数量
  reason: '',
})

const material = computed(() => (props.materialId ? store.getMaterial(props.materialId) : undefined))
const currentBalance = computed(() => (props.materialId ? store.getBalance(props.materialId) : 0))
const takeDiff = computed(() => toNumber(form.qty) - currentBalance.value)

const titleMap: Record<StockTxnType, string> = {
  入库: '材料入库',
  领用: '材料领用',
  盘点调整: '盘点调整',
}

const reasonPlaceholderMap: Record<StockTxnType, string> = {
  入库: '请填写进货来源或原因，如：五金店采购',
  领用: '请填写领用用途或原因，如：书架制作',
  盘点调整: '请填写盘点盈亏原因，如：清点发现损耗',
}

const qtyLabel = computed(() => (props.type === '盘点调整' ? '实盘数量' : '数量'))

const rules = computed<FormRules>(() => ({
  qty:
    props.type === '盘点调整'
      ? [{ required: true, message: '请输入实盘数量', trigger: 'blur' }]
      : [{ required: true, message: '请输入数量', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写原因', trigger: 'blur' }],
}))

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      // 盘点默认带出账面数量，调整时只改差额即可
      form.qty = props.type === '盘点调整' ? currentBalance.value : 1
      form.reason = ''
      formRef.value?.clearValidate()
    }
  },
)

async function submit() {
  if (!formRef.value || !props.materialId || !material.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  try {
    if (props.type === '入库') {
      store.stockIn(props.materialId, toNumber(form.qty), form.reason)
    } else if (props.type === '领用') {
      store.stockOut(props.materialId, toNumber(form.qty), form.reason)
    } else {
      store.stocktake(props.materialId, toNumber(form.qty), form.reason)
    }
    ElMessage.success('流水已记录，库存已更新')
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="titleMap[type]"
    width="460px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="material" class="txn-meta">
      <span>{{ material.name }}</span>
      <el-tag size="small" type="info">{{ material.category }}</el-tag>
      <span class="muted">当前库存：<b>{{ currentBalance }}</b> {{ material.unit }}</span>
    </div>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item :label="qtyLabel" prop="qty">
        <el-input-number v-model="form.qty" :min="0" />
        <span v-if="type !== '盘点调整'" class="muted" style="margin-left: 8px">{{ material?.unit }}</span>
        <span v-else class="muted" style="margin-left: 8px">
          {{ material?.unit }}，
          <span :style="{ color: takeDiff === 0 ? 'var(--text-secondary)' : takeDiff > 0 ? 'var(--success)' : 'var(--danger)' }">
            {{ takeDiff === 0 ? '与账面一致' : takeDiff > 0 ? `盘盈 +${takeDiff}` : `盘亏 ${takeDiff}` }}
          </span>
        </span>
      </el-form-item>
      <el-form-item label="原因" prop="reason">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="3"
          maxlength="100"
          show-word-limit
          :placeholder="reasonPlaceholderMap[type]"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submit">记账</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.txn-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: var(--page-bg);
  border-radius: 6px;
  font-weight: 600;
}
</style>
