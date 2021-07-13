import { asEither, asNumber, asObject, asString, asValue } from 'cleaners'
import {
  EdgeCurrencyEngineOptions,
  EdgeCurrencyInfo,
  EdgeCurrencyTools,
  EdgeIo,
  EdgeWalletInfo
} from 'edge-core-js'

import { IUTXO } from '../utxobased/db/types'
import { EngineEmitter } from './makeEngineEmitter'
import { PluginState } from './pluginState'

// this enumerates the network types of single coins. Can be expanded to add regtest, signet, stagenet etc.
export enum NetworkEnum {
  Mainnet = 'mainnet',
  Testnet = 'testnet'
}

export type CurrencyFormat = ReturnType<typeof asCurrencyFormat>
export const asCurrencyFormat = asEither(
  asValue('bip32'),
  asValue('bip44'),
  asValue('bip49'),
  asValue('bip84')
)

export type AddressPath = ReturnType<typeof asAddressPath>
export const asAddressPath = asObject({
  format: asCurrencyFormat,
  changeIndex: asNumber,
  addressIndex: asNumber
})

export enum EngineCurrencyType {
  UTXO
}

export interface TxOptions {
  utxos?: IUTXO[]
  subtractFee?: boolean
  setRBF?: boolean
  CPFP?: string
}

export interface EngineCurrencyInfo extends EdgeCurrencyInfo {
  formats?: CurrencyFormat[]
  forks?: string[]
  coinType: number
  currencyType: EngineCurrencyType
  network: string // The offical network in lower case - Needs to match the Bitcoin Lib Network Type
  networkType?: NetworkEnum
  uriPrefix?: string
  gapLimit: number
  defaultFee: number
  feeUpdateInterval: number
  earnComFeeInfoServer?: string
  mempoolSpaceFeeInfoServer?: string
  customFeeSettings: CustomFeeSetting[]
  simpleFeeSettings: SimpleFeeSettings
}

export type CustomFeeSetting = 'satPerByte'

export type FeeRates = ReturnType<typeof asFeeRatesCleaner>

export const asFeeRatesCleaner = asObject({
  lowFee: asString,
  standardFeeLow: asString,
  standardFeeHigh: asString,
  highFee: asString
})

export interface SimpleFeeSettings extends FeeRates {
  standardFeeLowAmount: string
  standardFeeHighAmount: string
}

export const asSimpleFeeSettingsCleaner = asObject({
  standardFeeLowAmount: asString,
  standardFeeHighAmount: asString,
  lowFee: asString,
  standardFeeLow: asString,
  standardFeeHigh: asString,
  highFee: asString
})

export interface EngineConfig {
  network: NetworkEnum
  walletInfo: EdgeWalletInfo
  currencyInfo: EngineCurrencyInfo
  currencyTools: EdgeCurrencyTools
  options: EngineOptions
  io: EdgeIo
  pluginState: PluginState
}

export interface EngineOptions extends EdgeCurrencyEngineOptions {
  emitter: EngineEmitter
}

export type LocalWalletMetadata = ReturnType<
  typeof asLocalWalletMetadataCleaner
>

export const asLocalWalletMetadataCleaner = asObject({
  balance: asString,
  lastSeenBlockHeight: asNumber
})
