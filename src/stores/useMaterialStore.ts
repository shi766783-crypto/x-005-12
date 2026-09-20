import { computed } from 'vue'
import type { Material, MaterialTxn, StockTxnType } from '../types'
import { useLocalStorage } from '../utils/storage'
import { uid } from '../utils/id'
import { toNumber } from '../utils/format'

// 模块级单例状态
const materials = useLocalStorage<Material[]>('diy.materials', [])
const txns = useLocalStorage<MaterialTxn[]>('diy.materialTxns', [])

/**
 * 存量数据迁移：流水功能上线前，库存只有一个最终数字。
 * 为每种尚无流水的材料补一笔「期初入库」，原因记为旧库存导入，
 * 使「流水变化之和」恰好等于当前库存，保证两者对得上。仅执行一次。
 */
;(function migrateOpeningTxns() {
  if (localStorage.getItem('diy.materialTxns.migrated') === '1') return
  for (const m of materials.value) {
    const exists = txns.value.some((t) => t.materialId === m.id)
    if (!exists && toNumber(m.quantity) > 0) {
      txns.value.push({
        id: uid('txn_'),
        materialId: m.id,
        materialName: m.name,
        unit: m.unit,
        type: '入库',
        change: toNumber(m.quantity),
        balance: toNumber(m.quantity),
        reason: '期初库存导入',
        time: m.createdAt,
      })
    }
  }
  localStorage.setItem('diy.materialTxns.migrated', '1')
})()

/** 按材料汇总流水变化之和：materialId -> 结余 */
function sumTxnsByMaterial(list: MaterialTxn[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of list) {
    map.set(t.materialId, (map.get(t.materialId) ?? 0) + toNumber(t.change))
  }
  return map
}

/** 取单个材料的最新流水（time 相同取后创建的） */
function latestTxn(list: MaterialTxn[], materialId: string): MaterialTxn | undefined {
  let latest: MaterialTxn | undefined
  for (const t of list) {
    if (t.materialId !== materialId) continue
    if (!latest || t.time > latest.time || (t.time === latest.time && t.id > latest.id)) latest = t
  }
  return latest
}

export function useMaterialStore() {
  function addMaterial(data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Material {
    const now = Date.now()
    const material: Material = { ...data, id: uid('mat_'), createdAt: now, updatedAt: now }
    materials.value.push(material)
    // 建卡时填写的数量作为第一笔入库流水（期初入库），库存从此由流水决定
    if (toNumber(data.quantity) > 0) {
      txns.value.push({
        id: uid('txn_'),
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        type: '入库',
        change: toNumber(data.quantity),
        balance: toNumber(data.quantity),
        reason: '期初入库',
        time: now,
      })
    }
    return material
  }

  function updateMaterial(id: string, patch: Partial<Omit<Material, 'id' | 'createdAt' | 'quantity'>>) {
    const material = materials.value.find((m) => m.id === id)
    if (material) Object.assign(material, patch, { updatedAt: Date.now() })
  }

  /**
   * 删除材料：流水保留以备查账（材料名已快照在流水上），
   * 材料本身移除后不再计入库存与预警。
   */
  function removeMaterial(id: string) {
    materials.value = materials.value.filter((m) => m.id !== id)
  }

  function getMaterial(id: string): Material | undefined {
    return materials.value.find((m) => m.id === id)
  }

  /**
   * 核心不变量：库存数字始终由流水推导（全部数量变化之和），
   * 同时回写到 material.quantity 供列表直接展示，二者永远一致。
   */
  const balanceByMaterial = computed<Map<string, number>>(() => sumTxnsByMaterial(txns.value))

  function getBalance(materialId: string): number {
    return balanceByMaterial.value.get(materialId) ?? 0
  }

  /** 全部流水，按时间倒序（最近发生在前） */
  const sortedTxns = computed<MaterialTxn[]>(() =>
    [...txns.value].sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1)),
  )

  function txnsOf(materialId: string): MaterialTxn[] {
    return [...txns.value]
      .filter((t) => t.materialId === materialId)
      .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1))
  }

  /**
   * 记一笔库存变化。入库 change 为正、领用为负、盘点调整可正可负。
   * 校验库存充足/结果非负，通过后追加流水并同步库存数字。
   */
  function recordTxn(input: {
    materialId: string
    type: StockTxnType
    change: number
    reason: string
    time?: number
  }): MaterialTxn | undefined {
    const material = materials.value.find((m) => m.id === input.materialId)
    if (!material || !Number.isFinite(input.change) || input.change === 0) return undefined

    const balance = getBalance(input.materialId) + input.change
    if (balance < 0) {
      throw new Error(`库存不足：当前仅剩 ${balance - input.change} ${material.unit}`)
    }

    const txn: MaterialTxn = {
      id: uid('txn_'),
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      type: input.type,
      change: input.change,
      balance,
      reason: input.reason.trim(),
      time: input.time ?? Date.now(),
    }
    txns.value.push(txn)
    material.quantity = balance
    material.updatedAt = Date.now()
    return txn
  }

  /** 入库（进货）：数量须为正 */
  function stockIn(materialId: string, qty: number, reason: string, time?: number) {
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('入库数量须大于 0')
    return recordTxn({ materialId, type: '入库', change: qty, reason, time })
  }

  /** 领用（出库）：数量须为正，库存不足会被 recordTxn 拦下 */
  function stockOut(materialId: string, qty: number, reason: string, time?: number) {
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('领用数量须大于 0')
    return recordTxn({ materialId, type: '领用', change: -qty, reason, time })
  }

  /** 盘点调整：输入实盘数量，自动算出盈亏差并记账，实盘与账面一致时无需记账 */
  function stocktake(materialId: string, actualQty: number, reason: string, time?: number) {
    if (!Number.isFinite(actualQty) || actualQty < 0) throw new Error('实盘数量不能为负')
    const diff = actualQty - getBalance(materialId)
    if (diff === 0) throw new Error('实盘数量与账面一致，无需调整')
    return recordTxn({ materialId, type: '盘点调整', change: diff, reason, time })
  }

  /** 库存预警：流水结余低于最低库存预警值的材料 */
  const lowStockMaterials = computed(() =>
    materials.value.filter((m) => getBalance(m.id) < toNumber(m.minStock)),
  )

  /** 材料种类数 */
  const categoryCount = computed(() => materials.value.length)

  /** 对账：所有材料库存数字是否都与流水对得上（供界面自检提示） */
  const isReconciled = computed(() =>
    materials.value.every((m) => toNumber(m.quantity) === getBalance(m.id)),
  )

  /**
   * 校正：以流水为准重算所有材料库存。
   * 正常路径不会产生偏差，这里提供一个兜底，保证「库存始终和流水对得上」。
   */
  function reconcile() {
    const sums = sumTxnsByMaterial(txns.value)
    for (const m of materials.value) m.quantity = sums.get(m.id) ?? 0
    return isReconciled.value
  }

  return {
    materials,
    txns,
    sortedTxns,
    balanceByMaterial,
    addMaterial,
    updateMaterial,
    removeMaterial,
    getMaterial,
    getBalance,
    txnsOf,
    latestTxn: (materialId: string) => latestTxn(txns.value, materialId),
    recordTxn,
    stockIn,
    stockOut,
    stocktake,
    lowStockMaterials,
    categoryCount,
    isReconciled,
    reconcile,
  }
}
