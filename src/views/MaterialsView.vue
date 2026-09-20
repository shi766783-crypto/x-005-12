<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Material } from '../types'
import { MATERIAL_CATEGORIES, STOCK_TXN_TYPES, STOCK_TXN_TAG, type StockTxnType } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { formatDateTime } from '../utils/format'
import MaterialFormDialog from '../components/MaterialFormDialog.vue'
import StockTxnDialog from '../components/StockTxnDialog.vue'
import MaterialLedgerDrawer from '../components/MaterialLedgerDrawer.vue'

const materialStore = useMaterialStore()

const dialogVisible = ref(false)
const editingMaterial = ref<Material | null>(null)

// 出入库记账弹窗
const txnVisible = ref(false)
const txnType = ref<StockTxnType>('入库')
const txnMaterialId = ref<string | null>(null)

// 单材料流水抽屉
const ledgerVisible = ref(false)
const ledgerMaterialId = ref<string | null>(null)

const filterCategory = ref('')
const keyword = ref('')
const onlyLowStock = ref(false)

function balance(id: string): number {
  return materialStore.getBalance(id)
}

const filtered = computed(() =>
  materialStore.materials.value.filter((m) => {
    const matchCategory = !filterCategory.value || m.category === filterCategory.value
    const matchKeyword = !keyword.value || m.name.includes(keyword.value)
    const matchLowStock = !onlyLowStock.value || balance(m.id) < m.minStock
    return matchCategory && matchKeyword && matchLowStock
  }),
)

// 全局流水筛选
const txnKeyword = ref('')
const txnTypeFilter = ref<StockTxnType | ''>('')
const txnMaterialFilter = ref('')

const filteredTxns = computed(() =>
  materialStore.sortedTxns.value.filter((t) => {
    const matchKeyword = !txnKeyword.value || t.materialName.includes(txnKeyword.value) || t.reason.includes(txnKeyword.value)
    const matchType = !txnTypeFilter.value || t.type === txnTypeFilter.value
    const matchMaterial = !txnMaterialFilter.value || t.materialId === txnMaterialFilter.value
    return matchKeyword && matchType && matchMaterial
  }),
)

/** 材料是否已删除（流水保留，名称后标注） */
function materialExists(id: string): boolean {
  return !!materialStore.getMaterial(id)
}

function openAdd() {
  editingMaterial.value = null
  dialogVisible.value = true
}
function openEdit(material: Material) {
  editingMaterial.value = material
  dialogVisible.value = true
}
function openTxn(material: Material, type: StockTxnType) {
  txnMaterialId.value = material.id
  txnType.value = type
  txnVisible.value = true
}
function openLedger(materialId: string) {
  ledgerMaterialId.value = materialId
  ledgerVisible.value = true
}
async function remove(material: Material) {
  await ElMessageBox.confirm(
    `确定删除材料「${material.name}」吗？其历史出入库流水将保留以备查账，但该材料不再计入库存。`,
    '提示',
    { type: 'warning' },
  )
  materialStore.removeMaterial(material.id)
  ElMessage.success('已删除，历史流水已保留')
}
function changeText(change: number) {
  return change > 0 ? `+${change}` : `${change}`
}
function changeColorClass(type: StockTxnType) {
  return { 入库: 'num-in', 领用: 'num-out', 盘点调整: 'num-adjust' }[type]
}
function fixDrift() {
  materialStore.reconcile()
  ElMessage.success('已按流水校正库存数字')
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">材料库存</h2>
      <el-button type="primary" @click="openAdd">
        <el-icon><Plus /></el-icon>&nbsp;添加材料
      </el-button>
    </div>

    <section class="card" style="margin-bottom: 16px">
      <div class="section-head">
        <span class="section-title">库存预警面板</span>
        <el-tag v-if="materialStore.lowStockMaterials.value.length" type="warning">
          {{ materialStore.lowStockMaterials.value.length }} 种材料低于最低库存
        </el-tag>
        <el-tag v-else type="success">库存健康</el-tag>
      </div>
      <el-table v-if="materialStore.lowStockMaterials.value.length" :data="materialStore.lowStockMaterials.value" size="small" border>
        <el-table-column prop="name" label="材料" min-width="120" />
        <el-table-column prop="category" label="类别" width="100" />
        <el-table-column label="当前库存" width="110" align="center">
          <template #default="{ row }">
            <span class="gap-missing">{{ balance(row.id) }} {{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最低预警值" width="110" align="center">
          <template #default="{ row }">{{ row.minStock }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="location" label="存放位置" min-width="120" />
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button size="small" type="success" text @click="openTxn(row, '入库')">入库</el-button>
            <el-button size="small" type="warning" text @click="openTxn(row, '领用')">领用</el-button>
            <el-button size="small" type="danger" text @click="openTxn(row, '盘点调整')">盘点</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无预警材料" :image-size="60" />
    </section>

    <div class="card filter-bar">
      <el-input v-model="keyword" placeholder="搜索材料名称" clearable style="width: 200px" />
      <el-select v-model="filterCategory" placeholder="全部类别" clearable style="width: 150px">
        <el-option v-for="c in MATERIAL_CATEGORIES" :key="c" :label="c" :value="c" />
      </el-select>
      <el-checkbox v-model="onlyLowStock">仅看预警</el-checkbox>
      <span class="muted">共 {{ materialStore.categoryCount.value }} 种材料</span>
    </div>

    <div class="card" style="margin-bottom: 16px">
      <el-table :data="filtered" border>
        <el-table-column prop="name" label="名称" min-width="130" />
        <el-table-column prop="category" label="类别" width="90" />
        <el-table-column label="库存" width="110" align="center">
          <template #default="{ row }">
            <span :style="{ color: balance(row.id) < row.minStock ? 'var(--danger)' : 'inherit', fontWeight: balance(row.id) < row.minStock ? 600 : 400 }">
              {{ balance(row.id) }} {{ row.unit }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="最低预警值" width="100" align="center">
          <template #default="{ row }">{{ row.minStock }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="location" label="存放位置" min-width="110" />
        <el-table-column label="库存操作" width="250" align="center">
          <template #default="{ row }">
            <el-button size="small" type="success" @click="openTxn(row, '入库')">入库</el-button>
            <el-button size="small" type="warning" @click="openTxn(row, '领用')">领用</el-button>
            <el-button size="small" type="danger" plain @click="openTxn(row, '盘点调整')">盘点</el-button>
          </template>
        </el-table-column>
        <el-table-column label="更多" width="150" align="center">
          <template #default="{ row }">
            <el-button size="small" @click="openLedger(row.id)">流水</el-button>
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" text @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <div class="section-head">
        <span class="section-title">材料出入库流水</span>
        <span class="head-right">
          <el-tag v-if="materialStore.isReconciled.value" type="success">库存与流水一致</el-tag>
          <el-button v-else size="small" type="danger" text @click="fixDrift">库存与流水不一致 · 点击校正</el-button>
        </span>
      </div>
      <div class="filter-bar">
        <el-input v-model="txnKeyword" placeholder="搜索材料名或原因" clearable style="width: 220px" />
        <el-select v-model="txnTypeFilter" placeholder="全部类型" clearable style="width: 140px">
          <el-option v-for="t in STOCK_TXN_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select v-model="txnMaterialFilter" placeholder="全部材料" clearable filterable style="width: 180px">
          <el-option v-for="m in materialStore.materials.value" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <span class="muted">共 {{ filteredTxns.length }} 笔</span>
      </div>
      <el-table :data="filteredTxns" border size="small" max-height="460">
        <el-table-column label="时间" width="140">
          <template #default="{ row }">{{ formatDateTime(row.time) }}</template>
        </el-table-column>
        <el-table-column label="材料" min-width="130">
          <template #default="{ row }">
            <span :class="{ 'muted': !materialExists(row.materialId) }">{{ row.materialName }}</span>
            <el-tag v-if="!materialExists(row.materialId)" type="info" size="small" style="margin-left: 4px">已删除</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="STOCK_TXN_TAG[row.type as StockTxnType]" size="small">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="数量变化" width="100" align="center">
          <template #default="{ row }">
            <span :class="['txn-change', changeColorClass(row.type)]">{{ changeText(row.change) }} {{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结余" width="90" align="center">
          <template #default="{ row }">{{ row.balance }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button v-if="materialExists(row.materialId)" size="small" text type="primary" @click="openLedger(row.materialId)">
              全部流水
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!filteredTxns.length" description="暂无出入库流水，点击材料行的「入库 / 领用 / 盘点」开始记账" :image-size="80" />
    </div>

    <MaterialFormDialog v-model="dialogVisible" :material="editingMaterial" />
    <StockTxnDialog v-model="txnVisible" :type="txnType" :material-id="txnMaterialId" />
    <MaterialLedgerDrawer v-model="ledgerVisible" :material-id="ledgerMaterialId" />
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  font-weight: 600;
  font-size: 15px;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.txn-change {
  font-weight: 600;
}
.num-in {
  color: var(--success);
}
.num-out {
  color: var(--warning);
}
.num-adjust {
  color: var(--danger);
}
</style>
