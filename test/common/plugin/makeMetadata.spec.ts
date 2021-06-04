import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Disklet, makeMemoryDisklet } from 'disklet'
import { MemoryStorage } from 'disklet/lib/src/backends/memory'
import { EdgeLog } from 'edge-core-js'

import {
  EngineEmitter,
  EngineEvent
} from '../../../src/common/plugin/makeEngineEmitter'
import { makeMetadata, Metadata } from '../../../src/common/plugin/makeMetadata'

chai.should()
chai.use(chaiAsPromised)

const wait = async (seconds: number): Promise<void> =>
  await new Promise(resolve => setTimeout(resolve, seconds * 1000))

describe('makeMetadata', () => {
  const memory: MemoryStorage = {}
  let disklet: Disklet
  let metadata: Metadata
  let log: EdgeLog
  const emitter = new EngineEmitter()

  before(async () => {
    disklet = makeMemoryDisklet(memory)
    metadata = await makeMetadata({
      disklet,
      emitter,
      log
    })
  })

  describe('block height update', () => {
    it('should only ever increase the block height', async function () {
      this.timeout(3000)

      metadata.lastSeenBlockHeight.should.eql(0)

      emitter.emit(EngineEvent.BLOCK_HEIGHT_CHANGED, '', 10)
      await wait(1)
      metadata.lastSeenBlockHeight.should.eql(10)

      emitter.emit(EngineEvent.BLOCK_HEIGHT_CHANGED, '', 5)
      await wait(1)
      metadata.lastSeenBlockHeight.should.eql(10)
    })
  })
})
