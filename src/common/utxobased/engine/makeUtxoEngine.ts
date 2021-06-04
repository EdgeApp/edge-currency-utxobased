import * as bs from 'biggystring'
import { navigateDisklet } from 'disklet'
import {
  EdgeCurrencyCodeOptions,
  EdgeCurrencyEngine,
  EdgeDataDump,
  EdgeFreshAddress,
  EdgeGetTransactionsOptions,
  EdgePaymentProtocolInfo,
  EdgeSpendInfo,
  EdgeTokenInfo,
  EdgeTransaction,
  JsonObject
} from 'edge-core-js'

import { FEES_DISKLET_PATH } from '../../constants'
import { makeFees } from '../../fees/makeFees'
import { EngineEmitter, EngineEvent } from '../../plugin/makeEngineEmitter'
import { makeMetadata } from '../../plugin/makeMetadata'
import { EngineConfig, TxOptions } from '../../plugin/types'
import { getMnemonic } from '../../plugin/utils'
import { makeProcessor } from '../db/makeProcessor'
import {
  fromEdgeTransaction,
  toEdgeTransaction
} from '../db/Models/ProcessorTransaction'
import { IProcessorTransaction, IUTXO } from '../db/types'
import { makeTx, MakeTxTarget, signTx } from '../keymanager/keymanager'
import { makeUtxoEngineState } from './makeUtxoEngineState'
import { makeUtxoWalletTools } from './makeUtxoWalletTools'
import { createPayment, getPaymentDetails, sendPayment } from './paymentRequest'
import { UTXOTxOtherParams } from './types'
import {
  fetchOrDeriveXprivFromKeys,
  getWalletFormat,
  getWalletSupportedFormats,
  getXpubs
} from './utils'

export async function makeUtxoEngine(
  config: EngineConfig
): Promise<EdgeCurrencyEngine> {
  const {
    network,
    currencyInfo,
    walletInfo,
    options: { walletLocalDisklet, walletLocalEncryptedDisklet, emitter, log },
    io,
    pluginState
  } = config

  const walletFormat = getWalletFormat(walletInfo)
  if (
    currencyInfo.formats == null ||
    !currencyInfo.formats.includes(walletFormat)
  ) {
    const message = `Wallet format is not supported: ${walletFormat}`
    log.error(message)
    throw new Error(message)
  }

  const walletTools = makeUtxoWalletTools({
    keys: walletInfo.keys,
    coin: currencyInfo.network,
    network
  })

  const fees = await makeFees({
    disklet: navigateDisklet(walletLocalDisklet, FEES_DISKLET_PATH),
    currencyInfo,
    io,
    log: config.options.log
  })

  const metadata = await makeMetadata({
    disklet: walletLocalDisklet,
    emitter,
    log
  })
  const processor = await makeProcessor({
    disklet: walletLocalDisklet,
    emitter
  })
  const state = makeUtxoEngineState({
    ...config,
    walletTools,
    processor,
    pluginState
  })

  emitter.on(
    EngineEvent.PROCESSOR_TRANSACTION_CHANGED,
    async (tx: IProcessorTransaction) => {
      emitter.emit(EngineEvent.TRANSACTIONS_CHANGED, [
        await toEdgeTransaction({
          tx,
          currencyCode: currencyInfo.currencyCode,
          walletTools,
          processor
        })
      ])
    }
  )

  const fns: EdgeCurrencyEngine = {
    async startEngine(): Promise<void> {
      emitter.emit(
        EngineEvent.WALLET_BALANCE_CHANGED,
        config.currencyInfo.currencyCode,
        metadata.balance
      )
      await fees.start()
      await state.start()
    },

    async killEngine(): Promise<void> {
      await state.stop()
      fees.stop()
    },

    getBalance(_opts: EdgeCurrencyCodeOptions): string {
      return metadata.balance
    },

    getBlockHeight(): number {
      return metadata.lastSeenBlockHeight
    },

    async addCustomToken(_token: EdgeTokenInfo): Promise<unknown> {
      return await Promise.resolve(undefined)
    },

    addGapLimitAddresses(addresses: string[]): undefined {
      void state.addGapLimitAddresses(addresses)
      return
    },

    async broadcastTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
      const { otherParams } = transaction
      if (
        otherParams?.paymentProtocolInfo?.payment != null &&
        otherParams?.paymentProtocolInfo?.paymentUrl != null
      ) {
        const paymentAck = await sendPayment(
          io.fetch,
          otherParams.paymentProtocolInfo.paymentUrl,
          otherParams.paymentProtocolInfo.payment
        )
        if (typeof paymentAck === 'undefined') {
          throw new Error(
            `Error when sending to ${otherParams.paymentProtocolInfo.paymentUrl}`
          )
        }
      }
      const id = await state.broadcastTx(transaction)
      if (id !== transaction.txid) {
        throw new Error('broadcast response txid does not match original')
      }
      return transaction
    },

    async changeUserSettings(userSettings: JsonObject): Promise<void> {
      await pluginState.updateServers(userSettings)
    },

    async disableTokens(_tokens: string[]): Promise<unknown> {
      return await Promise.resolve(undefined)
    },

    async dumpData(): Promise<EdgeDataDump> {
      return {
        walletId: walletInfo.id.split(' - ')[0],
        walletType: walletInfo.type,
        data: {
          walletInfo: {
            walletFormat,
            walletFormatsSupported: getWalletSupportedFormats(walletInfo),
            pluginType: currencyInfo.pluginId
          },
          processorState: await processor.dumpData(),
          pluginState: pluginState.dumpData()
        }
      }
    },

    async enableTokens(_tokens: string[]): Promise<unknown> {
      return await Promise.resolve(undefined)
    },

    getDisplayPrivateSeed(): string | null {
      return getMnemonic({ keys: walletInfo.keys, coin: currencyInfo.network })
    },

    getDisplayPublicSeed(): string | null {
      const xpubs = getXpubs({
        keys: walletInfo.keys,
        coin: currencyInfo.network
      })
      return Object.values(xpubs).join('\n')
    },

    async getEnabledTokens(): Promise<string[]> {
      return await Promise.resolve([])
    },

    getFreshAddress(
      _opts: EdgeCurrencyCodeOptions
    ): Promise<EdgeFreshAddress> | EdgeFreshAddress {
      return state.getFreshAddress()
    },

    getNumTransactions(_opts: EdgeCurrencyCodeOptions): number {
      return processor.getNumTransactions()
    },

    async getPaymentProtocolInfo(
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      return await getPaymentDetails(
        paymentProtocolUrl,
        network,
        currencyInfo.currencyCode,
        io.fetch
      )
    },

    getTokenStatus(_token: string): boolean {
      return false
    },

    async getTransactions(
      opts: EdgeGetTransactionsOptions
    ): Promise<EdgeTransaction[]> {
      const txs = await processor.fetchTransactions(opts)
      return await Promise.all(
        txs.map(
          async (tx: IProcessorTransaction) =>
            await toEdgeTransaction({
              tx,
              currencyCode: currencyInfo.currencyCode,
              walletTools,
              processor
            })
        )
      )
    },

    async isAddressUsed(address: string): Promise<boolean> {
      const scriptPubkey = walletTools.addressToScriptPubkey(address)
      const addressData = await processor.fetchAddressByScriptPubkey(
        scriptPubkey
      )
      return addressData?.used === true
    },

    async makeSpend(
      edgeSpendInfo: EdgeSpendInfo,
      options?: TxOptions
    ): Promise<EdgeTransaction> {
      let targets: MakeTxTarget[] = []
      const ourReceiveAddresses: string[] = []
      for (const target of edgeSpendInfo.spendTargets) {
        if (target.publicAddress == null || target.nativeAmount == null) {
          throw new Error('Invalid spend target')
        }

        const scriptPubkey = walletTools.addressToScriptPubkey(
          target.publicAddress
        )
        if (await processor.hasSPubKey(scriptPubkey)) {
          ourReceiveAddresses.push(target.publicAddress)
        }

        targets.push({
          address: target.publicAddress,
          value: parseInt(target.nativeAmount)
        })
      }

      const freshAddress = await state.getFreshAddress(1)
      const freshChangeAddress =
        freshAddress.segwitAddress ?? freshAddress.publicAddress
      const utxos = options?.utxos ?? (await processor.fetchAllUtxos())
      const setRBF = options?.setRBF ?? false
      const rbfTxid = edgeSpendInfo.rbfTxid
      let maxUtxo: undefined | IUTXO
      let feeRate = parseInt(await fees.getRate(edgeSpendInfo))
      if (rbfTxid != null) {
        const rbfTx = await processor.fetchTransaction(rbfTxid)
        if (rbfTx == null) throw new Error('transaction not found')
        // double the fee used for the RBF transaction
        feeRate *= 2
        const rbfInputs = rbfTx.inputs
        const maxInput = rbfInputs.reduce((a, b) =>
          bs.gt(a.amount, b.amount) ? a : b
        )
        const maxId = `${maxInput.txId}_${maxInput.outputIndex}`
        maxUtxo = await processor.fetchUtxo(maxId)
        if (maxUtxo == null) {
          maxUtxo = await processor.fetchSpentUtxo(maxId)
        }
        if (maxUtxo == null) {
          log.error('transaction to be replaced found, but not its input utxos')
          throw new Error(
            'transaction to be replaced found, but not its input utxos'
          )
        }
      }
      if (options?.CPFP != null) {
        const childTx = await processor.fetchTransaction(options?.CPFP)
        if (childTx == null) throw new Error('transaction not found')
        const utxos: IUTXO[] = []
        for (const txid of childTx.ourOuts) {
          const output = await processor.fetchUtxo(txid)
          if (output != null) utxos.push(output)
        }
        maxUtxo = utxos.reduce((a, b) => (bs.gt(a.value, b.value) ? a : b))
        // cpfp just sends to change, no target addresses are required
        targets = []
      }
      log.warn(`spend: Using fee rate ${feeRate} sat/B`)
      const subtractFee =
        options?.subtractFee != null ? options.subtractFee : false
      const tx = await makeTx({
        utxos,
        forceUseUtxo: maxUtxo != null ? [maxUtxo] : [],
        targets,
        feeRate,
        coin: currencyInfo.network,
        network,
        setRBF,
        freshChangeAddress,
        subtractFee
      })
      if (tx.changeUsed) {
        ourReceiveAddresses.push(freshChangeAddress)
      }

      let nativeAmount = '0'
      for (const output of tx.outputs) {
        const scriptPubkey = output.script.toString('hex')
        const own = await processor.hasSPubKey(scriptPubkey)
        if (!own) {
          nativeAmount = bs.sub(nativeAmount, output.value.toString())
        }
      }

      const networkFee = tx.fee.toString()
      nativeAmount = bs.sub(nativeAmount, networkFee)

      return {
        ourReceiveAddresses,
        otherParams: {
          psbt: {
            base64: tx.psbtBase64,
            inputs: tx.inputs
          },
          edgeSpendInfo
        },
        currencyCode: currencyInfo.currencyCode,
        txid: '',
        date: 0,
        blockHeight: 0,
        nativeAmount,
        networkFee,
        feeRateUsed: {
          satPerVByte: feeRate
        },
        signedTx: ''
      }
    },

    async resyncBlockchain(): Promise<void> {
      // stops and resets the state
      await state.stop()
      // now get rid of all the db information
      await processor.clearAll()
      // clear the networking cache
      await pluginState.clearCache()
      await metadata.clear()

      // finally restart the state
      await state.start()
    },

    async saveTx(tx: EdgeTransaction): Promise<void> {
      return await processor.saveTransaction(fromEdgeTransaction(tx))
    },

    async signTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
      const { psbt, edgeSpendInfo }: Partial<UTXOTxOtherParams> =
        transaction.otherParams ?? {}
      if (psbt == null || edgeSpendInfo == null)
        throw new Error('Invalid transaction data')

      // Derive the xprivs on the fly, since we do not persist them
      const xprivKeys = await fetchOrDeriveXprivFromKeys({
        keys: walletInfo.keys,
        walletLocalEncryptedDisklet,
        coin: currencyInfo.network,
        network
      })

      const privateKeys = await Promise.all(
        psbt.inputs.map(async ({ hash, index }) => {
          const txid = Buffer.isBuffer(hash)
            ? hash.reverse().toString('hex')
            : hash

          const utxo = await processor.fetchUtxo(`${txid}_${index}`)
          if (utxo == null) throw new Error('Invalid UTXO')

          const address = await processor.fetchAddressByScriptPubkey(
            utxo.scriptPubkey
          )
          if (address?.path == null) throw new Error('Invalid script pubkey')

          return walletTools.getPrivateKey({ path: address.path, xprivKeys })
        })
      )
      const signedTx = await signTx({
        psbtBase64: psbt.base64,
        coin: currencyInfo.network,
        privateKeys
      })
      transaction.txid = signedTx.id
      transaction.signedTx = signedTx.hex

      const { paymentProtocolInfo } =
        transaction.otherParams?.edgeSpendInfo?.otherParams ?? {}
      if (paymentProtocolInfo != null) {
        const payment = createPayment(
          transaction.signedTx,
          transaction.currencyCode
        )
        Object.assign(transaction.otherParams, {
          paymentProtocolInfo: {
            ...paymentProtocolInfo,
            payment
          }
        })
      }

      return transaction
    },

    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const privateKeys = spendInfo.privateKeys ?? []
      if (privateKeys.length < 1) throw new Error('No private keys given')
      let success: (
        value: EdgeTransaction | PromiseLike<EdgeTransaction>
      ) => void
      let failure: (reason?: never) => void
      const end: Promise<EdgeTransaction> = new Promise((resolve, reject) => {
        success = resolve
        failure = reject
      })
      const tmpDisklet = walletLocalDisklet
      const tmpEmitter = new EngineEmitter()
      const tmpConfig = {
        disklet: tmpDisklet,
        emitter: tmpEmitter,
        log
      }
      const tmpMetadata = await makeMetadata(tmpConfig)
      const tmpProcessor = await makeProcessor(tmpConfig)
      const tmpWalletTools = makeUtxoWalletTools({
        keys: { wifKeys: privateKeys },
        coin: currencyInfo.network,
        network
      })

      tmpEmitter.on(EngineEvent.ADDRESSES_CHECKED, async (ratio: number) => {
        if (ratio === 1) {
          await tmpState.stop()

          const utxos = await processor.fetchAllUtxos()
          if (utxos === null || utxos.length < 1) {
            throw new Error('Private key has no funds')
          }
          const publicAddress = await this.getFreshAddress({})
          const nativeAmount = tmpMetadata.balance
          const options: TxOptions = { utxos, subtractFee: true }
          spendInfo.spendTargets = [
            { publicAddress: publicAddress.publicAddress, nativeAmount }
          ]
          // @ts-expect-error TODO: TheCharlatan - add option to makeSpend declaration in edge-core-js
          this.makeSpend(spendInfo, options)
            .then(tx => success(tx))
            .catch(e => failure(e))
        }
      })

      const tmpState = makeUtxoEngineState({
        ...config,
        options: {
          ...config.options,
          emitter: tmpEmitter
        },
        currencyInfo: {
          ...config.currencyInfo,
          // hack to not overflow the wallet tools private key array
          gapLimit: privateKeys.length + 1
        },
        walletTools: tmpWalletTools,
        processor: tmpProcessor,
        pluginState
      })
      await tmpState.start()
      return end
    }
  }

  return fns
}
