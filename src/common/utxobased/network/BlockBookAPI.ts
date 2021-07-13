import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import { EdgeTransaction } from 'edge-core-js'

export interface PartialTask {
  method: string
  params: unknown
}

interface IAccountOpts {
  details?: string
  from?: number
  to?: number
  page?: number
  perPage?: number
}

export const pingMessage = (): PartialTask => {
  return {
    method: 'ping',
    params: undefined
  }
}

export const infoMessage = (): PartialTask => {
  return {
    method: 'getInfo',
    params: {}
  }
}

export const asIServerInfoCleaner = asObject({
  name: asString,
  shortcut: asString,
  decimals: asNumber,
  version: asString,
  bestHeight: asNumber,
  bestHash: asString,
  block0Hash: asString,
  testnet: asBoolean,
  backend: asOptional(
    asObject({
      version: asString,
      subversion: asString
    })
  )
})

export const addressUtxosMessage = (account: string): PartialTask => {
  return {
    method: 'getAccountUtxo',
    params: { descriptor: account }
  }
}

export const asAddressUtxosCleaner = asArray(
  asObject({
    txid: asString,
    vout: asNumber,
    value: asString,
    height: asOptional(asNumber),
    confirmations: asOptional(asNumber),
    lockTime: asOptional(asNumber),
    address: asOptional(asString),
    path: asOptional(asString)
  })
)

export const transactionMessage = (hash: string): PartialTask => {
  return {
    method: 'getTransaction',
    params: { txid: hash }
  }
}

export const asITransactionCleaner = asObject({
  txid: asString,
  hex: asString,
  blockHeight: asNumber,
  confirmations: asNumber,
  blockTime: asNumber,
  fees: asString,
  vin: asArray(
    asObject({
      txid: asString,
      sequence: asNumber,
      n: asNumber,
      addresses: asArray(asString),
      isAddress: asBoolean,
      value: asString,
      hex: asOptional(asString)
    })
  ),
  vout: asArray(
    asObject({
      n: asNumber,
      value: asString,
      addresses: asArray(asString),
      hex: asOptional(asString)
    })
  )
})

export const broadcastTxMessage = (
  transaction: EdgeTransaction
): PartialTask => {
  return {
    method: 'sendTransaction',
    params: { hex: transaction.signedTx }
  }
}

export const asITransactionBroadcastResponseCleaner = asObject({
  result: asString
})

export const addressMessage = (
  address: string,
  opts: IAccountOpts = {}
): PartialTask => {
  opts = Object.assign(
    {},
    {
      details: 'basic',
      page: 1,
      perPage: 100
    },
    opts
  )
  return {
    method: 'getAccountInfo',
    params: {
      ...opts,
      descriptor: address
    }
  }
}

export const subscribeNewBlockMessage = (): PartialTask => {
  return {
    method: 'subscribeNewBlock',
    params: {}
  }
}

export const asINewBlockResponseCleaner = asObject({
  height: asNumber,
  hash: asString
})

export const subscribeAddressesMessage = (addresses: string[]): PartialTask => {
  return {
    method: 'subscribeAddresses',
    params: { addresses }
  }
}

export const asINewTransactionResponseCleaner = asObject({
  address: asString,
  tx: asITransactionCleaner
})
