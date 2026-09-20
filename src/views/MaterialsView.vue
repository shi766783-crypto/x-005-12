<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Material, TxnType } from '../types'
import { MATERIAL_CATEGORIES } from '../types'
import { useMaterialStore } from '../stores/useMaterialStore'
import { formatDateTime } from '../utils/format'
import MaterialFormDialog from '../components/MaterialFormDialog.vue'
import MaterialTxnDialog from '../components/MaterialTxnDialog.vue'

const materialStore = useMaterialStore()

const dialogVisible = ref(false)
const editingMaterial = ref<Material | null>(null)

// 出入库 / 盘点记账弹窗
const txnVisible = ref(false)
const txnMaterialId = ref('')
const txnType = ref<TxnType>('入库')

const filterCategory = ref('')
const keyword = ref('')
const onlyLowStock = ref(false)

const filtered = computed(() =>
  materialStore.materials.value.filter((m) => {
    const matchCategory = !filterCategory.value || m.category === filterCategory.value
    const matchKeyword = !keyword.value || m.name.includes(keyword.value)
    const matchLowStock = !onlyLowStock.value || m.quantity < m.minStock
    return matchCategory && matchKeyword && matchLowStock
  }),
)

function openAdd() {
  editingMaterial.value = null
  dialogVisible.value = true
}
function openEdit(material: Material) {
  editingMaterial.value = material
  dialogVisible.value = true
}
async function remove(material: Material) {
  await ElMessageBox.confirm(
    `确定删除材料「${material.name}」吗？该材料的全部出入库流水也会一并删除。`,
    '提示',
    { type: 'warning' },
  )
  materialStore.removeMaterial(material.id)
  ElMessage.success('已删除')
}

function openTxn(type: TxnType, materialId = '') {
  txnType.value = type
  txnMaterialId.value = materialId
  txnVisible.value = true
}

/** 展开行：该材料最近的流水 */
function recentTxns(material: Material) {
  return materialStore.transactionsOf(material.id).slice(0, 8)
}

function changeClass(change: number) {
  return change >= 0 ? 'change-in' : 'change-out'
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">材料库存</h2>
      <div class="head-actions">
        <el-button @click="$router.push({ name: 'material-ledger' })">
          <el-icon><Document /></el-icon>&nbsp;出入库流水
        </el-button>
        <el-button type="primary" @click="openAdd">
          <el-icon><Plus /></el-icon>&nbsp;添加材料
        </el-button>
      </div>
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
            <span class="gap-missing">{{ row.quantity }} {{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最低预警值" width="110" align="center">
          <template #default="{ row }">{{ row.minStock }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="location" label="存放位置" min-width="120" />
        <el-table-column label="建议" min-width="170">
          <template #default="{ row }">
            <el-tag type="danger" size="small">需补货 {{ row.minStock - row.quantity }} {{ row.unit }}</el-tag>
            <el-button size="small" type="success" text @click="openTxn('入库', row.id)">记一笔入库</el-button>
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

    <div class="card">
      <el-table :data="filtered" border row-key="id">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="txn-panel">
              <div class="txn-panel-head">
                <span class="section-title">「{{ row.name }}」最近流水</span>
                <div>
                  <el-button size="small" type="success" text @click="openTxn('入库', row.id)">入库</el-button>
                  <el-button size="small" type="warning" text @click="openTxn('领用', row.id)">领用</el-button>
                  <el-button size="small" type="primary" text @click="openTxn('调整', row.id)">盘点调整</el-button>
                  <router-link
                    class="muted"
                    :to="{ name: 'material-ledger', query: { material: row.id } }"
                  >查看全部</router-link>
                </div>
              </div>
              <el-table :data="recentTxns(row)" size="small" border>
                <el-table-column label="时间" width="150">
                  <template #default="{ row: t }">{{ formatDateTime(t.happenedAt) }}</template>
                </el-table-column>
                <el-table-column label="类型" width="80" align="center">
                  <template #default="{ row: t }">
                    <el-tag :type="t.type === '入库' ? 'success' : t.type === '领用' ? 'warning' : 'primary'" size="small">
                      {{ t.type }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="变化" width="90" align="center">
                  <template #default="{ row: t }">
                    <span :class="changeClass(t.change)">{{ t.change > 0 ? '+' : '' }}{{ t.change }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="结存" width="90" align="center">
                  <template #default="{ row: t }">{{ t.balance }} {{ t.unit }}</template>
                </el-table-column>
                <el-table-column prop="reason" label="原因" width="110" />
                <el-table-column prop="note" label="备注" min-width="140">
                  <template #default="{ row: t }">{{ t.note || '—' }}</template>
                </el-table-column>
                <template #empty><span class="muted">暂无流水</span></template>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="130" />
        <el-table-column prop="category" label="类别" width="100" />
        <el-table-column label="数量" width="110" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.quantity < row.minStock ? 'var(--danger)' : 'inherit', fontWeight: row.quantity < row.minStock ? 600 : 400 }">
              {{ row.quantity }} {{ row.unit }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="最低预警值" width="110" align="center">
          <template #default="{ row }">{{ row.minStock }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="location" label="存放位置" min-width="120" />
        <el-table-column label="出入库" width="200" align="center">
          <template #default="{ row }">
            <el-button size="small" type="success" text @click="openTxn('入库', row.id)">入库</el-button>
            <el-button size="small" type="warning" text @click="openTxn('领用', row.id)">领用</el-button>
            <el-button size="small" type="primary" text @click="openTxn('调整', row.id)">盘点</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" text @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <MaterialFormDialog v-model="dialogVisible" :material="editingMaterial" />
    <MaterialTxnDialog v-model="txnVisible" :material-id="txnMaterialId" :default-type="txnType" />
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
.txn-panel {
  padding: 8px 16px 12px 48px;
}
.txn-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
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
