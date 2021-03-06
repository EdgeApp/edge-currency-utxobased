import { Disklet, makeMemoryDisklet } from 'disklet'
import {
  EdgeFetchFunction,
  EdgeFetchHeaders,
  EdgeFetchOptions,
  EdgeIo,
  EdgeLog
} from 'edge-core-js'

import {
  EngineCurrencyInfo,
  EngineCurrencyType
} from '../src/common/plugin/types'

export const makeFakeCurrencyInfo = (
  currencyType = EngineCurrencyType.UTXO
): EngineCurrencyInfo => {
  return {
    addressExplorer: '',
    coinType: 0,
    currencyCode: '',
    currencyType,
    customFeeSettings: [],
    defaultFee: 0,
    defaultSettings: {},
    denominations: [],
    displayName: '',
    feeUpdateInterval: 0,
    gapLimit: 0,
    metaTokens: [],
    network: '',
    pluginId: '',
    simpleFeeSettings: {
      highFee: '1',
      lowFee: '2',
      standardFeeHigh: '3',
      standardFeeHighAmount: '4',
      standardFeeLow: '5',
      standardFeeLowAmount: '6'
    },
    transactionExplorer: '',
    walletType: ''
  }
}

export const makeFakeLog = (): EdgeLog => {
  const fakeLog = (): void => {
    return
  }
  fakeLog.warn = () => {
    return
  }
  fakeLog.error = () => {
    return
  }
  return fakeLog
}

interface FakeIoConfig {
  disklet?: Disklet
}
export const makeFakeIo = (config?: FakeIoConfig): EdgeIo => {
  return {
    // @ts-expect-error - assigned to null
    console: null,
    disklet: config?.disklet ?? makeMemoryDisklet(),
    fetch: makeFakeFetch(),
    random(_bytes: number): Uint8Array {
      return new Uint8Array()
    },
    async scrypt(
      _data: Uint8Array,
      _salt: Uint8Array,
      _n: number,
      _r: number,
      _p: number,
      _dklen: number
    ): Promise<Uint8Array> {
      return new Uint8Array()
    }
  }
}

const makeFakeFetch = (): EdgeFetchFunction => async (
  _uri: string,
  _opts?: EdgeFetchOptions
) => {
  return {
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0)
    },
    headers: {
      forEach: (
        _callback: (
          value: string,
          name: string,
          self: EdgeFetchHeaders
        ) => void,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _thisArg?: any
      ): undefined => {
        return undefined
      },
      get: (_name: string): string | null => {
        return null
      },
      has: (_name: string): boolean => {
        return false
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async json(): Promise<any> {
      return {}
    },
    ok: true,
    status: 200,
    async text(): Promise<string> {
      return await Promise.resolve('')
    }
  }
}
