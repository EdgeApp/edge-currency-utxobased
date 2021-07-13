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

import { asAddressPath } from '../../plugin/types'
import { ScriptTypeEnum } from '../keymanager/keymanager'

export type IAddress = ReturnType<typeof asIAddressCleaner>

export const asIAddressCleaner = asObject({
  scriptPubkey: asString,
  networkQueryVal: asNumber,
  path: asOptional(asAddressPath),
  lastQuery: asNumber,
  lastTouched: asNumber,
  used: asBoolean,
  balance: asString
})

export type IUTXO = ReturnType<typeof asIUTXOCleaner>

interface EnumObject {
  [enumValue: string]: string
}

function getEnumValues(e: EnumObject): string[] {
  return Object.keys(e).map(i => e[i])
}

const asScriptTypeEnum = (value: unknown): ScriptTypeEnum => {
  const valueString = asString(value)
  const values = getEnumValues(ScriptTypeEnum)
  const [scriptType] = values.filter(elem => valueString === elem)
  if (scriptType == null) {
    throw new TypeError('Expected a script type enum')
  }
  return ScriptTypeEnum[scriptType as keyof typeof ScriptTypeEnum]
}

export const asIUTXOCleaner = asObject({
  id: asString,
  txid: asString,
  vout: asNumber,
  value: asString,
  scriptPubkey: asString,
  script: asString,
  redeemScript: asOptional(asString),
  scriptType: asScriptTypeEnum,
  blockHeight: asNumber
})

export type IProcessorTransaction = ReturnType<
  typeof asIProcessorTransactionCleaner
>

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
