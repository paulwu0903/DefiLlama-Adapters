const sui = require('../helper/chain/sui')
const { post } = require('../helper/http')
const { getEnv } = require('../helper/env')

const WAD = 10n ** 18n

const MARKET_OBJECT_IDS = [
  '0x9bf6685a4f25bc007c404b336c8f5b82f853171d20b9bb530060674430fc1da8', // MainMarket
  '0xe07d4f34978933f275f358b6648ad9186c32b608187229c4e27d70de882621c5', // AltCoinMarket
  '0x68f53e1b577354dd4318a0279fe4ae61cc5a47b0df651309cb4d18770fd6e259', // EmberMarket
  '0xd17a7ec9fdb623bf35bb9af32ae5c29aae930d6ceb35592078218fe9f3357172', // MatrixGoldMarket
  '0xe7ddcd7f380a0f773b294cf4b86973e967497854b57264cba811becae856f73c', // EthenaMarket
]

function coinTypeFromName(name) {
  return name.startsWith('0x') ? name : `0x${name}`
}

async function listDynamicFieldObjectIds(parentTableId) {
  const ids = []
  let cursor = null
  const rpc = getEnv('SUI_RPC')
  do {
    const { result } = await post(rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getDynamicFields',
      params: [parentTableId, cursor, 48],
    })
    const { data, hasNextPage, nextCursor } = result
    for (const row of data) ids.push(row.objectId)
    cursor = hasNextPage ? nextCursor : null
  } while (cursor)
  return ids
}

let loadReserveRowsPromise = null

async function loadReserveRows() {
  const rows = []
  for (const marketId of MARKET_OBJECT_IDS) {
    const marketContent = await sui.getObject(marketId)
    const fieldIds = await listDynamicFieldObjectIds(
      marketContent.fields.reserves.fields.table.fields.table.fields.id.id,
    )
    const objects = await sui.getObjects(fieldIds)
    for (const obj of objects) {
      const name = obj.fields.name.fields.name
      const reserve = obj.fields.value.fields
      rows.push({ coinType: coinTypeFromName(name), reserve })
    }
  }
  return rows
}

function getReserveRows() {
  if (!loadReserveRowsPromise) loadReserveRowsPromise = loadReserveRows()
  return loadReserveRowsPromise
}

async function tvl(api) {
  for (const { coinType, reserve } of await getReserveRows()) {
    api.add(coinType, BigInt(reserve.cash))
  }
}

async function borrowed(api) {
  for (const { coinType, reserve } of await getReserveRows()) {
    api.add(coinType, BigInt(reserve.debt.fields.value) / WAD)
  }
}

module.exports = {
  timetravel: false,
  methodology:
    'TVL sums Reserve.cash (u64 underlying units) per asset for each reserve in the listed markets. Per reserve.move, cash is the reserve on-chain underlying balance. Borrowed sums Reserve.debt (fixed-point Decimal) divided by 1e18 — total outstanding borrows. Reserve.cash_reserve (protocol fee accrual) is not included in this TVL sum.',
  sui: { tvl, borrowed },
}
