import { BaseType } from 'baselet'
import { CountBase } from 'baselet/src/CountBase'
import { HashBase } from 'baselet/src/HashBase'
import { RangeBase } from 'baselet/src/RangeBase'
import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import { AddressPath, asAddressPath } from '../../plugin/types'
import { ScriptTypeEnum } from '../keymanager/keymanager'

export interface IAddress {
  scriptPubkey: string
  networkQueryVal: number
  path?: AddressPath
  lastQuery: number
  lastTouched: number
  used: boolean
  balance: string
}
export const asIAddress = asObject<IAddress>({
  scriptPubkey: asString,
  networkQueryVal: asNumber,
  path: asAddressPath,
  lastQuery: asNumber,
  lastTouched: asNumber,
  used: asBoolean,
  balance: asString
})

export interface IUTXO {
  id: string
  txid: string
  vout: number
  value: string
  scriptPubkey: string
  script: string
  redeemScript?: string
  scriptType: ScriptTypeEnum
  blockHeight: number
}

export const asIUTXOCleaner = asObject({
  id: asString,
  txid: asString,
  vout: asNumber,
  value: asString,
  scriptPubkey: asString,
  redeeemScript: asOptional(asString),
  scriptType: asString,
  blockHeight: asNumber
})

export interface IProcessorTransaction {
  txid: string
  hex: string
  blockHeight: number
  date: number
  fees: string
  inputs: ITransactionInput[]
  outputs: ITransactionOutput[]
  ourIns: string[]
  ourOuts: string[]
  ourAmount: string
}

export interface ITransactionOutput {
  amount: string
  scriptPubkey: string
}

export interface ITransactionInput extends ITransactionOutput {
  txId: string
  outputIndex: number
}

export const asIProcessorTransactionCleaner = asObject({
  txid: asString,
  hex: asString,
  blockHeight: asNumber,
  date: asNumber,
  fees: asString,
  inputs: asArray(
    asObject({
      txId: asString,
      outputIndex: asNumber,
      amount: asString,
      scriptPubkey: asString
    })
  ),
  outputs: asArray(
    asObject({
      amount: asString,
      scriptPubkey: asString
    })
  ),
  ourIns: asArray(asString),
  ourOuts: asArray(asString),
  ourAmount: asString
})

export interface BaseletConfig<T extends BaseType> {
  dbName: string
  type: T
  bucketSize: number
}

export type Baselet = HashBase | CountBase | RangeBase
