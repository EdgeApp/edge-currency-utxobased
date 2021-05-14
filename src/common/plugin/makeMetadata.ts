import * as bs from 'biggystring'
import { Disklet } from 'disklet'
import { makeMemlet, Memlet } from 'memlet'

import { EngineEmitter, EngineEvent } from './makeEngineEmitter'
import { LocalWalletMetadata } from './types'

const metadataPath = `metadata.json`

interface MetadataConfig {
  disklet: Disklet
  emitter: EngineEmitter
}

export interface Metadata extends LocalWalletMetadata {
  clear: (currencyCode: string) => Promise<void>
}

export const makeMetadata = async (
  config: MetadataConfig
): Promise<Metadata> => {
  const { disklet, emitter } = config
  const memlet = makeMemlet(disklet)

  let cache: LocalWalletMetadata = await fetchMetadata(memlet)

  emitter.on(
    EngineEvent.ADDRESS_BALANCE_CHANGED,
    async (currencyCode: string, balanceDiff: string) => {
      cache.balance = bs.add(cache.balance, balanceDiff)
      emitter.emit(
        EngineEvent.WALLET_BALANCE_CHANGED,
        currencyCode,
        cache.balance
      )
      await setMetadata(memlet, cache)
    }
  )

  emitter.on(EngineEvent.BLOCK_HEIGHT_CHANGED, async (height: number) => {
    if (height > cache.lastSeenBlockHeight) {
      cache.lastSeenBlockHeight = height
      await setMetadata(memlet, cache)
    }
  })

  return {
    get balance() {
      return cache.balance
    },
    get lastSeenBlockHeight() {
      return cache.lastSeenBlockHeight
    },
    clear: async (currencyCode: string) => {
      await memlet.delete(metadataPath)
      cache = await resetMetadata(memlet)
      emitter.emit(
        EngineEvent.WALLET_BALANCE_CHANGED,
        currencyCode,
        cache.balance
      )
    }
  }
}

const fetchMetadata = async (memlet: Memlet): Promise<LocalWalletMetadata> => {
  try {
    const dataStr = await memlet.getJson(metadataPath)
    return JSON.parse(dataStr)
  } catch {
    return await resetMetadata(memlet)
  }
}

const resetMetadata = async (memlet: Memlet): Promise<LocalWalletMetadata> => {
  const data: LocalWalletMetadata = {
    balance: '0',
    lastSeenBlockHeight: 0
  }
  await memlet.setJson(metadataPath, JSON.stringify(data))
  return data
}

const setMetadata = async (
  memlet: Memlet,
  data: LocalWalletMetadata
): Promise<void> => {
  await memlet.setJson(metadataPath, JSON.stringify(data))
}
