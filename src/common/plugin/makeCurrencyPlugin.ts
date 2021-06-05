import { EdgeCorePluginOptions, EdgeCurrencyPlugin } from 'edge-core-js'
import {
  EdgeCurrencyEngine,
  EdgeCurrencyEngineOptions,
  EdgeCurrencyTools,
  EdgeWalletInfo
} from 'edge-core-js/lib/types/types'

import { makeUtxoEngine } from '../utxobased/engine/makeUtxoEngine'
import { makeCurrencyTools } from './makeCurrencyTools'
import { EngineEmitter, EngineEvent } from './makeEngineEmitter'
import { PluginState } from './pluginState'
import {
  EngineConfig,
  EngineCurrencyInfo,
  EngineCurrencyType,
  NetworkEnum
} from './types'

export function makeCurrencyPlugin(
  pluginOptions: EdgeCorePluginOptions,
  currencyInfo: EngineCurrencyInfo
): EdgeCurrencyPlugin {
  const { io, log } = pluginOptions
  const currencyTools = makeCurrencyTools(io, currencyInfo)
  const { defaultSettings, pluginId, currencyCode } = currencyInfo
  const {
    customFeeSettings,
    blockBookServers,
    disableFetchingServers
  } = defaultSettings
  const state = new PluginState({
    io,
    currencyCode,
    pluginId,
    log,
    defaultSettings: {
      customFeeSettings,
      blockBookServers,
      disableFetchingServers
    }
  })
  return {
    currencyInfo,

    async makeCurrencyEngine(
      walletInfo: EdgeWalletInfo,
      engineOptions: EdgeCurrencyEngineOptions
    ): Promise<EdgeCurrencyEngine> {
      const emitter = new EngineEmitter()
      emitter.on(
        EngineEvent.TRANSACTIONS_CHANGED,
        engineOptions.callbacks.onTransactionsChanged
      )
      emitter.on(
        EngineEvent.WALLET_BALANCE_CHANGED,
        engineOptions.callbacks.onBalanceChanged
      )
      emitter.on(
        EngineEvent.BLOCK_HEIGHT_CHANGED,
        (_uri: string, height: number) => {
          engineOptions.callbacks.onBlockHeightChanged(height)
        }
      )
      emitter.on(
        EngineEvent.ADDRESSES_CHECKED,
        engineOptions.callbacks.onAddressesChecked
      )
      emitter.on(
        EngineEvent.TXIDS_CHANGED,
        engineOptions.callbacks.onTxidsChanged
      )

      const network = NetworkEnum.Mainnet

      const engineConfig: EngineConfig = {
        network,
        walletInfo,
        currencyInfo,
        currencyTools,
        io,
        options: {
          ...pluginOptions,
          ...engineOptions,
          emitter
        },
        pluginState: state
      }

      let engine: EdgeCurrencyEngine
      switch (currencyInfo.currencyType) {
        case EngineCurrencyType.UTXO:
          engine = await makeUtxoEngine(engineConfig)
          break
      }

      return engine
    },

    async makeCurrencyTools(): Promise<EdgeCurrencyTools> {
      state.load().catch(e => {
        throw e
      })
      return currencyTools
    }
  }
}
