/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from 'chai'
import WS from 'ws'

import {
  EngineEmitter,
  EngineEvent
} from '../../../../src/common/plugin/makeEngineEmitter'
import {
  BlockBook,
  INewTransactionResponse,
  makeBlockBook
} from '../../../../src/common/utxobased/network/BlockBook'
import Deferred from '../../../../src/common/utxobased/network/Deferred'
import { WsTask } from '../../../../src/common/utxobased/network/Socket'

chai.should()

describe('BlockBook notifications tests with dummy server', function () {
  let websocketServer: WS.Server
  let blockBook: BlockBook
  let websocketClient: WebSocket
  let emitter: EngineEmitter

  beforeEach(async () => {
    websocketServer = new WS.Server({ port: 8080 })
    websocketServer.on('connection', (ws: WebSocket) => {
      websocketClient = ws
      websocketClient.onmessage = event => {
        const data = JSON.parse(event.data)
        switch (data.method) {
          case 'ping':
            websocketClient.send(
              JSON.stringify({
                id: data.id,
                data: {}
              })
            )
            break
          case 'subscribeAddress':
          case 'subscribeNewBlock':
            websocketClient.send(
              JSON.stringify({
                id: data.id,
                data: { subscribed: true }
              })
            )
            break
        }
      }
    })
    websocketServer.on('error', error => {
      console.log(error)
    })
    emitter = new EngineEmitter()
    const log = (..._args: unknown[]): void => {
      return
    }
    log.warn = (..._args: unknown[]): void => {
      return
    }
    log.error = (..._args: unknown[]): void => {
      return
    }

    const onQueueSpaceCB = async (
      _uri: string
    ): Promise<WsTask<unknown> | undefined> => {
      return
    }

    blockBook = makeBlockBook({
      emitter,
      log,
      walletId: '',
      onQueueSpaceCB,
      wsAddress: 'ws://localhost:8080'
    })
    await blockBook.connect()
    blockBook.isConnected.should.be.true
  })

  afterEach(async () => {
    await blockBook.disconnect()
    blockBook.isConnected.should.be.false
    websocketServer.close()
  })

  it('Test BlockBook watch address and watch block events', async () => {
    let test = false
    test.should.be.false

    emitter.on(
      EngineEvent.BLOCK_HEIGHT_CHANGED,
      (_uri: string, _blockHeight: number) => {
        test = true
      }
    )

    blockBook.watchBlocks(new Deferred<unknown>())
    websocketClient.send(
      '{"id":"subscribeNewBlock","data":{"height":1916453,"hash":"0000000000000e0444fa7c1540a96e5658898a59733311d08f01292e114e8d5b"}}'
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    test.should.be.true

    test = false
    websocketClient.send(
      '{"id":"subscribeNewBlock","data":{"height":1916453,"hash":"0000000000000e0444fa7c1540a96e5658898a59733311d08f01292e114e8d5b"}}'
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    test.should.be.true
    test = false

    test.should.be.false

    emitter.on(
      EngineEvent.NEW_ADDRESS_TRANSACTION,
      (_uri: string, _newTx: INewTransactionResponse) => {
        test = true
      }
    )
    blockBook.watchAddresses(
      ['tb1q8uc93239etekcywh2l0t7aklxwywhaw0xlexld'],
      new Deferred<unknown>()
    )
    websocketClient.send(
      '{"id":"subscribeAddresses","data":{"address":"tb1q8uc93239etekcywh2l0t7aklxwywhaw0xlexld","tx":{"txid":"cfd4c31709bd48026c6c1027c47cef305c47947d73248129fee3f4b63ca1af43","version":1,"vin":[{"txid":"e0965d6df36a4ba811fb29819beeae0203fe68e48143344908146a58c5333996","vout":1,"sequence":4294967295,"n":0,"addresses":["tb1qrps90para9l48lydp2xga0p5yyckuj5l7vsu6t"],"isAddress":true,"value":"81581580"}],"vout":[{"value":"100000","n":0,"hex":"00143f3058aa25caf36c11d757debf76df3388ebf5cf","addresses":["tb1q8uc93239etekcywh2l0t7aklxwywhaw0xlexld"],"isAddress":true},{"value":"81463900","n":1,"hex":"0014be4df3d4535bd56f4d35dc1ffdb58408b084ebaa","addresses":["tb1qhexl84znt02k7nf4ms0lmdvypzcgf6a2c9zduk"],"isAddress":true}],"blockHeight":0,"confirmations":0,"blockTime":1612198107,"value":"81563900","valueIn":"81581580","fees":"17680","hex":"01000000000101963933c5586a140849344381e468fe0302aeee9b8129fb11a84b6af36d5d96e00100000000ffffffff02a0860100000000001600143f3058aa25caf36c11d757debf76df3388ebf5cf5c0adb0400000000160014be4df3d4535bd56f4d35dc1ffdb58408b084ebaa0247304402201e7f25a03517d932b2df5d099da597132047f5b7bb5cff43252ba0113fc161d2022003b80682bf7f32e685b21a6f28abc494dcc73c34bc62233f918b54afbbaca36c0121029eea7dac242382a543f6288023ac5a62064bea27349d25fc93180b14d5dd117400000000"}}}'
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    test.should.be.true
    test = false
    websocketClient.send(
      '{"id":"subscribeAddresses","data":{"address":"tb1q8uc93239etekcywh2l0t7aklxwywhaw0xlexld","tx":{"txid":"cfd4c31709bd48026c6c1027c47cef305c47947d73248129fee3f4b63ca1af43","version":1,"vin":[{"txid":"e0965d6df36a4ba811fb29819beeae0203fe68e48143344908146a58c5333996","vout":1,"sequence":4294967295,"n":0,"addresses":["tb1qrps90para9l48lydp2xga0p5yyckuj5l7vsu6t"],"isAddress":true,"value":"81581580"}],"vout":[{"value":"100000","n":0,"hex":"00143f3058aa25caf36c11d757debf76df3388ebf5cf","addresses":["tb1q8uc93239etekcywh2l0t7aklxwywhaw0xlexld"],"isAddress":true},{"value":"81463900","n":1,"hex":"0014be4df3d4535bd56f4d35dc1ffdb58408b084ebaa","addresses":["tb1qhexl84znt02k7nf4ms0lmdvypzcgf6a2c9zduk"],"isAddress":true}],"blockHeight":0,"confirmations":0,"blockTime":1612198107,"value":"81563900","valueIn":"81581580","fees":"17680","hex":"01000000000101963933c5586a140849344381e468fe0302aeee9b8129fb11a84b6af36d5d96e00100000000ffffffff02a0860100000000001600143f3058aa25caf36c11d757debf76df3388ebf5cf5c0adb0400000000160014be4df3d4535bd56f4d35dc1ffdb58408b084ebaa0247304402201e7f25a03517d932b2df5d099da597132047f5b7bb5cff43252ba0113fc161d2022003b80682bf7f32e685b21a6f28abc494dcc73c34bc62233f918b54afbbaca36c0121029eea7dac242382a543f6288023ac5a62064bea27349d25fc93180b14d5dd117400000000"}}}'
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    test.should.be.true
  })
})

describe('BlockBook', function () {
  this.timeout(10000)

  const satoshiAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
  const emitter = new EngineEmitter()
  const log = (..._args: unknown[]): void => {
    return
  }
  log.warn = (..._args: unknown[]): void => {
    return
  }
  log.error = (..._args: unknown[]): void => {
    return
  }
  let blockBook: BlockBook

  const onQueueSpaceCB = async (
    _uri: string
  ): Promise<WsTask<unknown> | undefined> => {
    return
  }

  beforeEach(async () => {
    blockBook = makeBlockBook({
      emitter,
      log,
      wsAddress: 'wss://btc1.trezor.io/websocket',
      walletId: '',
      onQueueSpaceCB
    })
    await blockBook.connect()
  })

  afterEach(async () => {
    await blockBook.disconnect()
  })

  describe('connect', function () {
    it('should connect to the BlockBook websocket API', async function () {
      blockBook.isConnected.should.be.true
    })
  })

  describe('disconnect', function () {
    it('should disconnect from the BlockBook API', async function () {
      blockBook.isConnected.should.be.true
      await blockBook.disconnect()
      blockBook.isConnected.should.be.false
    })
  })

  describe('fetchInfo', function () {
    it('should fetch the BlockBook server info', async function () {
      blockBook.isConnected.should.be.true
      const info = await blockBook.fetchInfo()
      info.should.have.keys(
        'name',
        'shortcut',
        'decimals',
        'version',
        'bestHeight',
        'bestHash',
        'block0Hash',
        'testnet',
        'backend'
      )
    })
  })

  describe('fetchAddress', function () {
    it('should fetch basic address information', async function () {
      const info = await blockBook.fetchAddress(satoshiAddress)

      info.should.have.property('address', satoshiAddress)
      info.should.have.property('balance')
      info.should.have.property('totalReceived')
      info.should.have.property('totalSent')
      info.should.have.property('txs')
      info.should.have.property('unconfirmedBalance')
      info.should.have.property('unconfirmedTxs')
    })
    it('should fetch address information with tx ids', async function () {
      const info = await blockBook.fetchAddress(satoshiAddress, {
        details: 'txids'
      })

      info.should.have.property('address', satoshiAddress)
      info.should.have.property('balance')
      info.should.have.property('totalReceived')
      info.should.have.property('totalSent')
      info.should.have.property('txs')
      info.should.have.property('unconfirmedBalance')
      info.should.have.property('unconfirmedTxs')
      info.should.have.property('page')
      info.should.have.property('totalPages')
      info.should.have.property('itemsOnPage')
      info.should.have.property('txids')
    })
    it('should fetch address information with txs', async function () {
      const info = await blockBook.fetchAddress(satoshiAddress, {
        details: 'txs'
      })

      info.should.have.property('address', satoshiAddress)
      info.should.have.property('balance')
      info.should.have.property('totalReceived')
      info.should.have.property('totalSent')
      info.should.have.property('txs')
      info.should.have.property('unconfirmedBalance')
      info.should.have.property('unconfirmedTxs')
      info.should.have.property('page')
      info.should.have.property('totalPages')
      info.should.have.property('itemsOnPage')
      info.should.have.property('transactions')
    })
  })

  describe('fetchAddressUtxos', function () {
    it('should fetch an address UTXOS', async function () {
      const utxos = await blockBook.fetchAddressUtxos(satoshiAddress)

      utxos.length.should.be.greaterThan(0)
      utxos[0].should.have.property('txid')
      utxos[0].should.have.property('vout')
      utxos[0].should.have.property('value')
    })
  })

  describe('fetchTransaction', function () {
    const satoshiHash =
      '3ed86f1b0a0a6fe180195bc1f93fd9d0801aea8c8ad5018de82c026dc21e2b15'
    it('should fetch details from a transaction hash', async function () {
      const tx = await blockBook.fetchTransaction(satoshiHash)

      tx.txid.should.equal(satoshiHash)
      tx.fees.should.equal('226')
      tx.blockHeight.should.equal(651329)
      tx.vin[0].value.should.equal('97373')
      tx.vout[1].value.should.equal('95000')
      tx.should.have.property('confirmations')
      tx.should.have.property('blockTime')
    })
  })
})
