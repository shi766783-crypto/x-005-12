import { computed } from 'vue'
import type { Material, MaterialTransaction, TxnType } from '../types'
import { useLocalStorage } from '../utils/storage'
import { uid } from '../utils/id'
import { toNumber } from '../utils/format'

// 模块级单例状态
const materials = useLocalStorage<Material[]>('diy.materials', [])
const transactions = useLocalStorage<MaterialTransaction[]>('diy.materialTransactions', [])

/**
 * 期初建账迁移：在流水功能上线前，材料只有一个最终数量、无从查起。
 * 为每一种尚无流水的材料补记一笔「期初建账」入库，使历史库存与流水对得上。
 * 迁移幂等：每种材料只补一次。
 */
function migrateOpeningBalances() {
  for (const m of materials.value) {
    const hasTxn = transactions.value.some((t) => t.materialId === m.id)
    if (hasTxn) continue
    const openingQty = toNumber(m.quantity)
    if (openingQty <= 0) continue
    transactions.value.push({
      id: uid('txn_'),
      materialId: m.id,
      materialName: m.name,
      unit: m.unit,
      type: '入库',
      change: openingQty,
      balance: openingQty,
      reason: '期初建账',
      note: '存量材料自动建账',
      happenedAt: m.createdAt,
      createdAt: m.createdAt,
    })
  }
  // 统一按发生时间归位并重算所有结存
  for (const m of materials.value) recomputeBalances(m.id)
}

/** 按发生时间排序某材料的全部流水，并重新累计每笔结存，最后回写库存数量 */
function recomputeBalances(materialId: string) {
  const list = transactions.value
    .filter((t) => t.materialId === materialId)
    .sort((a, b) => a.happenedAt - b.happenedAt || a.createdAt - b.createdAt)

  // 保留 3 位小数，消除 0.1+0.2 这类浮点累计误差
  const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000

  let balance = 0
  for (const t of list) {
    balance = round3(balance + t.change)
    t.balance = balance
  }

  const material = materials.value.find((m) => m.id === materialId)
  if (material && toNumber(material.quantity) !== balance) {
    material.quantity = balance
  }
  return balance
}

migrateOpeningBalances()

export interface TxnInput {
  type: TxnType
  /** 数量（非负，具体增减由 type 决定）；调整时表示调整后的目标库存 */
  amount: number
  reason: string
  note?: string
  happenedAt?: number
}

export function useMaterialStore() {
  function addMaterial(data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Material {
    const now = Date.now()
    const material: Material = { ...data, quantity: 0, id: uid('mat_'), createdAt: now, updatedAt: now }
    materials.value.push(material)

    // 新建时填写的数量作为第一笔入库（期初建账），之后数量一律走流水
    const openingQty = toNumber(data.quantity)
    if (openingQty > 0) {
      appendTxn(material.id, {
        type: '入库',
        amount: openingQty,
        reason: '期初建账',
        happenedAt: now,
        createdAt: now,
      })
    }
    return material
  }

  function updateMaterial(id: string, patch: Partial<Omit<Material, 'id' | 'createdAt'>>) {
    const material = materials.value.find((m) => m.id === id)
    if (!material) return
    // 数量不允许直接编辑：只能通过出入库/盘点流水改变，保证账实同源
    const { quantity, ...rest } = patch
    Object.assign(material, rest, { updatedAt: Date.now() })
    // 名称/单位改动同步到历史流水，保证流水仍可辨认且单位一致
    if (rest.name !== undefined || rest.unit !== undefined) {
      for (const t of transactions.value) {
        if (t.materialId !== id) continue
        if (rest.name !== undefined) t.materialName = rest.name
        if (rest.unit !== undefined) t.unit = rest.unit
      }
    }
  }

  function removeMaterial(id: string) {
    materials.value = materials.value.filter((m) => m.id !== id)
    transactions.value = transactions.value.filter((t) => t.materialId !== id)
  }

  function getMaterial(id: string): Material | undefined {
    return materials.value.find((m) => m.id === id)
  }

  /** 当前库存：直接取材料上的数量（每笔记账都会同步，且启动时按流水校准） */
  function currentBalance(materialId: string): number {
    return toNumber(getMaterial(materialId)?.quantity)
  }

  function appendTxn(
    materialId: string,
    input: TxnInput & { happenedAt: number; createdAt?: number },
  ): MaterialTransaction {
    const material = getMaterial(materialId)
    if (!material) throw new Error('材料不存在')

    const amount = toNumber(input.amount)
    const now = Date.now()
    const happenedAt = input.happenedAt ?? now
    const before = currentBalance(materialId)

    let change = 0
    if (input.type === '入库') {
      if (amount <= 0) throw new Error('入库数量必须大于 0')
      change = amount
    } else if (input.type === '领用') {
      if (amount <= 0) throw new Error('领用数量必须大于 0')
      if (amount > before) throw new Error(`库存不足：当前仅 ${before} ${material.unit}`)
      change = -amount
    } else {
      if (amount < 0) throw new Error('盘点数量不能为负数')
      change = amount - before
    }

    const txn: MaterialTransaction = {
      id: uid('txn_'),
      materialId,
      materialName: material.name,
      unit: material.unit,
      type: input.type,
      change,
      balance: before + change, // 临时值，随后统一重算
      reason: input.reason || (input.type === '调整' ? '盘点调整' : ''),
      note: input.note,
      happenedAt,
      createdAt: input.createdAt ?? now,
    }
    transactions.value.push(txn)
    recomputeBalances(materialId)
    material.updatedAt = now
    return txn
  }

  /** 登记一笔出入库/盘点流水（库存数量随之变化） */
  function recordTransaction(materialId: string, input: TxnInput): MaterialTransaction {
    return appendTxn(materialId, { ...input, happenedAt: input.happenedAt ?? Date.now() })
  }

  /** 某材料的流水：按发生时间倒序（最近的在前） */
  function transactionsOf(materialId: string): MaterialTransaction[] {
    return transactions.value
      .filter((t) => t.materialId === materialId)
      .sort((a, b) => b.happenedAt - a.happenedAt || b.createdAt - a.createdAt)
  }

  /** 由流水累计出的理论库存：按材料 ID 索引 */
  const ledgerBalanceMap = computed(() => {
    const map = new Map<string, number>()
    for (const t of transactions.value) {
      const raw = (map.get(t.materialId) ?? 0) + t.change
      // 与 recomputeBalances 一致的精度收敛，保证账实比对可靠
      map.set(t.materialId, Math.round((raw + Number.EPSILON) * 1000) / 1000)
    }
    return map
  })

  /** 账实不符的材料：材料数量与流水累计对不上（正常应为空） */
  const inconsistentMaterials = computed(() =>
    materials.value.filter((m) => toNumber(m.quantity) !== (ledgerBalanceMap.value.get(m.id) ?? 0)),
  )

  /** 库存预警：数量低于最低库存预警值的材料 */
  const lowStockMaterials = computed(() =>
    materials.value.filter((m) => toNumber(m.quantity) < toNumber(m.minStock)),
  )

  /** 材料种类数 */
  const categoryCount = computed(() => materials.value.length)

  return {
    materials,
    transactions,
    addMaterial,
    updateMaterial,
    removeMaterial,
    getMaterial,
    currentBalance,
    recordTransaction,
    transactionsOf,
    ledgerBalanceMap,
    inconsistentMaterials,
    lowStockMaterials,
    categoryCount,
  }
}
