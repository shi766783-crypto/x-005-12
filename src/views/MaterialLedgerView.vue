<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { MaterialTransaction, TxnType } from '../types'
import { TXN_TYPES } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { formatDateTime } from '../utils/format'
import MaterialTxnDialog from '../components/MaterialTxnDialog.vue'

const store = useMaterialStore()
const route = useRoute()

const dialogVisible = ref(false)
const dialogMaterialId = ref('')
const dialogType = ref<TxnType>('入库')

// 筛选条件（从材料库存页「查看全部」跳转时可带 ?material=id 预置）
const filterMaterialId = ref(typeof route.query.material === 'string' ? route.query.material : '')
const filterType = ref<TxnType | ''>('')
const keyword = ref('')
const dateRange = ref<[Date, Date] | null>(null)

/** 选中日期区间 → [当日 00:00, 当日 23:59:59.999] 时间戳 */
const timeRange = computed<[number, number] | null>(() => {
  if (!dateRange.value) return null
  const [start, end] = dateRange.value
  const startAt = new Date(start)
  startAt.setHours(0, 0, 0, 0)
  const endAt = new Date(end)
  endAt.setHours(23, 59, 59, 999)
  return [startAt.getTime(), endAt.getTime()]
})

const filteredTxns = computed(() =>
  store.transactions.value
    .filter((t) => {
      if (filterMaterialId.value && t.materialId !== filterMaterialId.value) return false
      if (filterType.value && t.type !== filterType.value) return false
      if (timeRange.value) {
        const [start, end] = timeRange.value
        if (t.happenedAt < start || t.happenedAt > end) return false
      }
      if (keyword.value) {
        const kw = keyword.value.trim()
        if (kw && !t.materialName.includes(kw) && !t.reason.includes(kw) && !(t.note ?? '').includes(kw))
          return false
      }
      return true
    })
    .sort((a, b) => b.happenedAt - a.happenedAt || b.createdAt - a.createdAt),
)

function openTxn(type: TxnType, materialId = '') {
  dialogType.value = type
  dialogMaterialId.value = materialId
  dialogVisible.value = true
}

function changeClass(t: MaterialTransaction) {
  if (t.type === '入库') return 'change-in'
  if (t.type === '领用') return 'change-out'
  return t.change >= 0 ? 'change-in' : 'change-out'
}

function changeText(t: MaterialTransaction) {
  const sign = t.change > 0 ? '+' : ''
  return `${sign}${t.change}`
}

function resetFilters() {
  filterMaterialId.value = ''
  filterType.value = ''
  keyword.value = ''
  dateRange.value = null
}

// 顶部提醒：理论上永远账实相符
const consistent = computed(() => store.inconsistentMaterials.value.length === 0)
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">材料出入库流水</h2>
      <div class="head-actions">
        <el-button type="success" @click="openTxn('入库', filterMaterialId)">
          <el-icon><Top /></el-icon>&nbsp;入库
        </el-button>
        <el-button type="warning" @click="openTxn('领用', filterMaterialId)">
          <el-icon><Bottom /></el-icon>&nbsp;领用
        </el-button>
        <el-button type="primary" @click="openTxn('调整', filterMaterialId)">
          <el-icon><ScaleToOriginal /></el-icon>&nbsp;盘点调整
        </el-button>
      </div>
    </div>

    <section class="card reconcile-bar">
      <el-tag :type="consistent ? 'success' : 'danger'">
        {{ consistent ? '账实相符：库存数字与流水累计一致' : `账实不符：${store.inconsistentMaterials.value.length} 种材料对不上` }}
      </el-tag>
      <span class="muted">共 {{ store.transactions.value.length }} 笔流水，当前筛选出 {{ filteredTxns.length }} 笔</span>
      <router-link class="ledger-link" :to="{ name: 'materials' }">返回材料库存</router-link>
    </section>

    <div class="card filter-bar">
      <el-select v-model="filterMaterialId" placeholder="全部材料" clearable filterable style="width: 180px">
        <el-option v-for="m in store.materials.value" :key="m.id" :label="m.name" :value="m.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 130px">
        <el-option v-for="t in TXN_TYPES" :key="t" :label="t" :value="t" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="width: 260px"
      />
      <el-input v-model="keyword" placeholder="搜索材料 / 原因 / 备注" clearable style="width: 220px" />
      <el-button text @click="resetFilters">重置</el-button>
    </div>

    <div class="card">
      <el-table :data="filteredTxns" border stripe size="default">
        <el-table-column label="发生时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.happenedAt) }}</template>
        </el-table-column>
        <el-table-column prop="materialName" label="材料" min-width="130">
          <template #default="{ row }">
            {{ row.materialName }}
            <span class="muted">（{{ row.unit }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.type === '入库' ? 'success' : row.type === '领用' ? 'warning' : 'primary'" size="small">
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="数量变化" width="110" align="center">
          <template #default="{ row }">
            <span :class="changeClass(row)">{{ changeText(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结存" width="100" align="center">
          <template #default="{ row }">
            <strong>{{ row.balance }}</strong> {{ row.unit }}
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" width="120" />
        <el-table-column prop="note" label="备注" min-width="160">
          <template #default="{ row }">
            <span :class="row.note ? '' : 'muted'">{{ row.note || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openTxn(row.type, row.materialId)">
              再记一笔
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无流水，点击右上角记一笔入库 / 领用 / 盘点" :image-size="80" />
        </template>
      </el-table>
    </div>

    <MaterialTxnDialog
      v-model="dialogVisible"
      :material-id="dialogMaterialId"
      :default-type="dialogType"
    />
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  flex-wrap: wrap;
}
.reconcile-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.ledger-link {
  margin-left: auto;
  color: var(--brand);
  font-size: 13px;
}
.change-in {
  color: var(--success);
  font-weight: 600;
}
.change-out {
  color: var(--danger);
  font-weight: 600;
}
</style>
