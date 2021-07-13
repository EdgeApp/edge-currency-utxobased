import * as bs from 'biggystring'
import { asMaybe } from 'cleaners'
import { Disklet } from 'disklet'
import { EdgeIo, EdgeLog, EdgeSpendInfo, EdgeSpendTarget } from 'edge-core-js'
import { makeMemlet, Memlet } from 'memlet'

import { FEES_PATH, INFO_SERVER_URI } from '../constants'
import {
  asSimpleFeeSettingsCleaner,
  EngineCurrencyInfo,
  SimpleFeeSettings
} from '../plugin/types'
import { calcMinerFeePerByte } from './calcMinerFeePerByte'
import { processEarnComFees } from './processEarnComFees'
import { processInfoServerFees } from './processInfoServerFees'
import { processMempoolSpaceFees } from './processMempoolSpaceFees'

interface MakeFeesConfig extends Common {
  disklet: Disklet
  currencyInfo: EngineCurrencyInfo
}

interface Common {
  io: EdgeIo
  log: EdgeLog
}

export interface Fees {
  start: () => Promise<void>
  stop: () => void
  getRate: (edgeSpendInfo: EdgeSpendInfo) => Promise<undefined | string>
  fees: SimpleFeeSettings | undefined
}

export const makeFees = async (config: MakeFeesConfig): Promise<Fees> => {
  const { disklet, currencyInfo, ...common } = config

  const memlet = makeMemlet(disklet)
  const fees = await fetchCachedFees(memlet, currencyInfo)

  // The last time the fees were updated
  let timestamp = 0
  let vendorIntervalId: NodeJS.Timeout

  const updateVendorFees = async (): Promise<void> => {
    if (Date.now() - timestamp <= currencyInfo.feeUpdateInterval) return

    const vendorFees = await fetchFeesFromVendor({
      ...common,
      earnComFeeInfoServer: currencyInfo.earnComFeeInfoServer,
      mempoolSpaceFeeInfoServer: currencyInfo.mempoolSpaceFeeInfoServer
    })
    Object.assign(fees, vendorFees ?? {})
    timestamp = Date.now()

    if (fees == null) return
    await cacheFees(memlet, fees)
  }

  return {
    async start(): Promise<void> {
      const edgeFees = await fetchFees({
        ...common,
        uri: `${INFO_SERVER_URI}/networkFees/${currencyInfo.currencyCode}`,
        processor: processInfoServerFees
      })
      Object.assign(fees, edgeFees)
      await updateVendorFees()
      vendorIntervalId = setInterval(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        updateVendorFees,
        currencyInfo.feeUpdateInterval
      )
    },

    stop(): void {
      clearInterval(vendorIntervalId)
    },

    async getRate(edgeSpendInfo: EdgeSpendInfo): Promise<undefined | string> {
      const {
        spendTargets,
        networkFeeOption,
        customNetworkFee = {},
        otherParams = {}
      } = edgeSpendInfo

      const requiredFeeRate =
        otherParams.paymentProtocolInfo?.merchant?.requiredFeeRate
      if (requiredFeeRate != null) {
        const rate = bs.add(bs.mul(requiredFeeRate, '1.5'), '1')
        return bs.toFixed(rate, 0, 0)
      }

      if (fees == null) return

      const rate = calcMinerFeePerByte(
        sumSpendTargets(spendTargets),
        fees,
        networkFeeOption,
        customNetworkFee[currencyInfo.customFeeSettings[0]]
      )
      return rate
    },

    get fees(): SimpleFeeSettings | undefined {
      return fees
    }
  }
}

const fetchCachedFees = async (
  memlet: Memlet,
  currencyInfo: EngineCurrencyInfo
): Promise<undefined | SimpleFeeSettings> => {
  const cleaner = asMaybe(asSimpleFeeSettingsCleaner)
  return cleaner(
    await memlet
      .getJson(FEES_PATH)
      // Return the simple fees settings from currency info by default
      .catch(() => currencyInfo.simpleFeeSettings)
  )
}

const cacheFees = async (
  memlet: Memlet,
  fees: SimpleFeeSettings
): Promise<void> => await memlet.setJson(FEES_PATH, fees)

const sumSpendTargets = (spendTargets: EdgeSpendTarget[]): string =>
  spendTargets.reduce((amount, { nativeAmount }) => {
    if (nativeAmount == null)
      throw new Error(`Invalid spend target amount: ${nativeAmount}`)
    return bs.add(amount, nativeAmount)
  }, '0')

interface FetchFeesArgs<T> extends Common {
  uri: string
  processor: (fees: unknown) => T
}
const fetchFees = async <T>(args: FetchFeesArgs<T>): Promise<T | null> => {
  const { uri, processor, io, log } = args

  try {
    const response = await io.fetch(uri)
    if (!response.ok) throw new Error(`Error fetching fees from ${uri}`)

    const fees = await response.json()
    return processor(fees)
  } catch (err) {
    log(err.message)
    return null
  }
}

interface FetchFeesFromVendorArgs extends Common {
  earnComFeeInfoServer?: string
  mempoolSpaceFeeInfoServer?: string
}

const fetchFeesFromVendor = async (
  args: FetchFeesFromVendorArgs
): Promise<Partial<SimpleFeeSettings>> => {
  if (args.earnComFeeInfoServer != null) {
    const earnComFees = await fetchFees({
      ...args,
      uri: args.earnComFeeInfoServer,
      processor: processEarnComFees
    })
    if (earnComFees != null) {
      return earnComFees
    }
  }

  if (args.mempoolSpaceFeeInfoServer != null) {
    const mempoolFees = await fetchFees({
      ...args,
      uri: args.mempoolSpaceFeeInfoServer,
      processor: processMempoolSpaceFees
    })
    if (mempoolFees != null) {
      return mempoolFees
    }
  }

  return {}
}
