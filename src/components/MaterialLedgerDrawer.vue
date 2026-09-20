<script setup lang="ts">
import { computed } from 'vue'
import { STOCK_TXN_TAG, type StockTxnType } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { formatDateTime } from '../utils/format'

const props = defineProps<{
  modelValue: boolean
  materialId: string | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useMaterialStore()

const material = computed(() => (props.materialId ? store.getMaterial(props.materialId) : undefined))
// 单个材料的流水按时间正序排列，便于逐笔核对结余变化
const rows = computed(() => (props.materialId ? store.txnsOf(props.materialId) : []))
const balance = computed(() => (props.materialId ? store.getBalance(props.materialId) : 0))

// 入/出/调整分项汇总
const totalIn = computed(() => rows.value.filter((r) => r.type === '入库').reduce((s, r) => s + r.change, 0))
const totalOut = computed(() =>
  rows.value.filter((r) => r.type === '领用').reduce((s, r) => s + Math.abs(r.change), 0),
)
const totalAdjust = computed(() => rows.value.filter((r) => r.type === '盘点调整').reduce((s, r) => s + r.change, 0))

function changeClass(type: StockTxnType) {
  return { 'num-in': type === '入库', 'num-out': type === '领用', 'num-adjust': type === '盘点调整' }
}
function changeText(change: number) {
  return change > 0 ? `+${change}` : `${change}`
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="material ? `出入库流水 · ${material.name}` : '出入库流水'"
    size="640px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="material" class="ledger-summary">
      <div class="ledger-balance">
        <span class="muted">当前库存</span>
        <span class="balance-num">{{ balance }} {{ material.unit }}</span>
      </div>
      <div class="ledger-stat"><span class="dot dot-in" />累计入库 <b>{{ totalIn }}</b></div>
      <div class="ledger-stat"><span class="dot dot-out" />累计领用 <b>{{ totalOut }}</b></div>
      <div class="ledger-stat">
        <span class="dot dot-adjust" />盘点净调整
        <b :class="totalAdjust >= 0 ? 'num-in' : 'num-out'">{{ changeText(totalAdjust) }}</b>
      </div>
    </div>

    <el-table :data="rows" border size="small">
      <el-table-column label="时间" width="140">
        <template #default="{ row }">{{ formatDateTime(row.time) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="STOCK_TXN_TAG[row.type as StockTxnType]" size="small">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="数量变化" width="90" align="center">
        <template #default="{ row }">
          <span :class="changeClass(row.type)">{{ changeText(row.change) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="结余" width="80" align="center">
        <template #default="{ row }">
          <b>{{ row.balance }}</b>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="150" show-overflow-tooltip />
    </el-table>
    <el-empty v-if="!rows.length" description="暂无出入库流水" :image-size="80" />

    <p class="muted ledger-note">流水按时间正序排列，每一笔都记录数量变化与原因；「结余」列即该笔之后的库存，末笔结余与当前库存一致。</p>
  </el-drawer>
</template>

<style scoped>
.ledger-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 14px;
  padding: 12px 14px;
  background: var(--page-bg);
  border-radius: 8px;
}
.ledger-balance {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-right: 8px;
}
.balance-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--brand);
}
.ledger-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-in {
  background: var(--success);
}
.dot-out {
  background: var(--warning);
}
.dot-adjust {
  background: var(--danger);
}
.num-in {
  color: var(--success);
  font-weight: 600;
}
.num-out {
  color: var(--warning);
  font-weight: 600;
}
.num-adjust {
  color: var(--danger);
  font-weight: 600;
}
.ledger-note {
  font-size: 12px;
  margin-top: 12px;
  line-height: 1.6;
}
</style>
