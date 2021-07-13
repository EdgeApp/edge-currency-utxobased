import { fail } from 'assert'
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { makeMemoryDisklet } from 'disklet'
import { MemoryStorage } from 'disklet/lib/src/backends/memory'

import { FEES_PATH } from '../../../src/common/constants'
import { Fees, makeFees } from '../../../src/common/fees/makeFees'
import { SimpleFeeSettings } from '../../../src/common/plugin/types'
import { makeFakeCurrencyInfo, makeFakeIo, makeFakeLog } from '../../utils'

chai.should()
chai.use(chaiAsPromised)
const { expect } = chai

describe('fees', function () {
  const fakeIo = makeFakeIo()
  const fakeLog = makeFakeLog()
  const fakeCurrencyInfo = makeFakeCurrencyInfo()
  const memory: MemoryStorage = {}
  const disklet = makeMemoryDisklet(memory)
  let fees: Fees

  const testJson = (expected?: SimpleFeeSettings): void => {
    const str = memory[`/${FEES_PATH}`]
    if (typeof str === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      expected == null
        ? expect(str).to.be.undefined
        : expect(JSON.parse(str)).to.eql(expected)
    }
  }

  describe('makeFees', () => {
    it('should load fees from the currency info file on wallet first load', async () => {
      fees = await makeFees({
        disklet,
        currencyInfo: fakeCurrencyInfo,
        io: fakeIo,
        log: fakeLog
      })

      // make typescript happy with this typecheck
      if (fees.fees == null)
        fail('internal fee object should not be null after makeFees')

      fees.fees.should.eql(fakeCurrencyInfo.simpleFeeSettings)

      testJson()
    })

    it('should cache fees after started', async () => {
      await fees.start()

      testJson(fakeCurrencyInfo.simpleFeeSettings)

      // be sure to stop after start, test will hang otherwise
      fees.stop()
    })
  })
})
