import { EdgeLog, EdgeWalletInfo } from 'edge-core-js'
import { EdgeTransaction } from 'edge-core-js/lib/types/types'
import { parse } from 'uri-js'

import { EngineEmitter, EngineEvent } from '../../plugin/makeEngineEmitter'
import { PluginState } from '../../plugin/pluginState'
import {
  BlockBook,
  makeBlockBook,
  WatchAddressesCB,
  WatchBlocksCB
} from '../network/BlockBook'
import Deferred from '../network/Deferred'
import { WsTask } from '../network/Socket'
import { pushUpdate, removeIdFromQueue } from '../network/socketQueue'
import { MAX_CONNECTIONS, NEW_CONNECTIONS } from './constants'

interface ServerState {
  subscribedBlocks: boolean
  txids: Set<string>
  addresses: Set<string>
}

interface ServerStateConfig {
  engineStarted: boolean
  walletInfo: EdgeWalletInfo
  pluginState: PluginState
  emitter: EngineEmitter
  log: EdgeLog
}

export interface ServerStates {
  setPickNextTaskCB: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (uri: string) => Promise<boolean | WsTask<any> | undefined>
  ) => void
  stop: () => void
  serverCanGetTx: (uri: string, txid: string) => boolean
  serverCanGetAddress: (uri: string, address: string) => boolean
  serverScoreUp: (uri: string, score: number) => void
  getServerState: (uri: string) => ServerState | undefined
  refillServers: () => void
  getServerList: () => string[]
  setServerList: (updatedServerList: string[]) => void
  broadcastTx: (transaction: EdgeTransaction) => Promise<string>
  watchAddresses: (
    uri: string,
    addresses: string[],
    cb: WatchAddressesCB,
    deferredAddressSub: Deferred<unknown>
  ) => void
  watchBlocks: (
    uri: string,
    cb: WatchBlocksCB,
    deferredBlockSub: Deferred<unknown>
  ) => void
}

export function makeServerStates(config: ServerStateConfig): ServerStates {
  const { engineStarted, walletInfo, pluginState, emitter, log } = config

  const serverStates = new Map<string, ServerState>()

  const connections = new Map<string, BlockBook>()
  let serverList: string[] = []
  let reconnectCounter = 0
  let reconnectTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
    return
  }, 0)
  let pickNextTaskCB: (
    uri: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<boolean | WsTask<any> | undefined>

  const setPickNextTaskCB = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (uri: string) => Promise<boolean | WsTask<any> | undefined>
  ): void => {
    pickNextTaskCB = callback
  }

  const stop = async (): Promise<void> => {
    removeIdFromQueue(walletInfo.id)
    clearTimeout(reconnectTimer)
    for (const uri of connections.keys()) {
      const blockBook = connections.get(uri)
      if (blockBook == null) continue
      await blockBook.disconnect()
      connections.delete(uri)
      serverStates.delete(uri)
    }
  }

  const reconnect = (): void => {
    if (engineStarted) {
      if (reconnectCounter < 5) reconnectCounter++
      reconnectTimer = setTimeout(() => {
        clearTimeout(reconnectTimer)
        refillServers()
      }, reconnectCounter * 1000)
    }
  }

  const refillServers = (): void => {
    pushUpdate({
      id: walletInfo.id,
      updateFunc: () => {
        doRefillServers()
      }
    })
  }

  const doRefillServers = (): void => {
    const includePatterns = ['wss:']
    if (serverList.length === 0) {
      serverList = pluginState.getServers(NEW_CONNECTIONS, includePatterns)
    }
    log(`refillServers: Top ${NEW_CONNECTIONS} servers:`, serverList)
    let chanceToBePicked = 1.25
    while (connections.size < MAX_CONNECTIONS) {
      if (serverList.length === 0) break
      const uri = serverList.shift()
      if (uri == null) {
        reconnect()
        break
      }
      if (connections.get(uri) != null) {
        continue
      }
      // Validate the URI of server to make sure it is valid
      const parsed = parse(uri)
      if (
        parsed.scheme == null ||
        parsed.scheme.length < 3 ||
        parsed.host == null
      ) {
        continue
      }
      chanceToBePicked -= chanceToBePicked > 0.5 ? 0.25 : 0
      if (Math.random() > chanceToBePicked) {
        serverList.push(uri)
        continue
      }
      const shortUrl = `${uri.replace('wss://', '').replace('/websocket', '')}:`

      emitter.on(EngineEvent.CONNECTION_OPEN, () => {
        reconnectCounter = 0
        log(`${shortUrl} ** Connected **`)
      })
      emitter.on(EngineEvent.CONNECTION_CLOSE, (error?: Error) => {
        connections.delete(uri)
        serverStates.delete(uri)
        const msg =
          error != null ? ` !! Connection ERROR !! ${error.message}` : ''
        log(`${shortUrl} onClose ${msg}`)
        if (error != null) {
          pluginState.serverScoreDown(uri)
        }
        reconnect()
      })
      emitter.on(EngineEvent.CONNECTION_TIMER, (queryDate: number) => {
        const queryTime = Date.now() - queryDate
        log(`${shortUrl} returned version in ${queryTime}ms`)
        pluginState.serverScoreUp(uri, queryTime)
      })
      emitter.on(EngineEvent.BLOCK_HEIGHT_CHANGED, (height: number) => {
        log(`${shortUrl} returned height: ${height}`)
        const serverState = serverStates.get(uri)
        if (serverState == null) {
          serverStates.set(uri, {
            subscribedBlocks: true,
            txids: new Set(),
            addresses: new Set()
          })
        } else if (!serverState.subscribedBlocks) {
          serverState.subscribedBlocks = true
        }
      })

      serverStates.set(uri, {
        subscribedBlocks: false,
        txids: new Set(),
        addresses: new Set()
      })

      const onQueueSpaceCB = async (): Promise<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WsTask<any> | boolean | undefined
      > => {
        const blockBook = connections.get(uri)
        if (blockBook == null) {
          return
        }
        const task = await pickNextTaskCB(uri)
        if (task != null && typeof task !== 'boolean') {
          const taskMessage = `${task.method} params: ${JSON.stringify(
            task.params
          )}`
          log(`${shortUrl} nextTask: ${taskMessage}`)
        }
        return task
      }

      connections.set(
        uri,
        makeBlockBook({
          wsAddress: uri,
          emitter,
          log,
          onQueueSpaceCB,
          walletId: walletInfo.id
        })
      )

      const blockBook = connections.get(uri)
      if (blockBook == null) continue
      blockBook
        .connect()
        .then(async () => {
          const queryTime = Date.now()
          const { bestHeight } = await blockBook.fetchInfo()
          pluginState.serverScoreUp(uri, Date.now() - queryTime)
          emitter.emit(EngineEvent.BLOCK_HEIGHT_CHANGED, bestHeight)
        })
        .catch(e => {
          log.error(`${JSON.stringify(e.message)}`)
        })
    }
  }

  const serverCanGetTx = (uri: string, txid: string): boolean => {
    const serverState = serverStates.get(uri)
    if (serverState == null) return false
    if (serverState.txids.has(txid)) return true

    for (const state of serverStates.values()) {
      if (state.txids.has(txid)) return false
    }
    return true
  }

  const serverCanGetAddress = (uri: string, address: string): boolean => {
    const serverState = serverStates.get(uri)
    if (serverState == null) return false
    if (serverState.addresses.has(address)) return true

    for (const state of serverStates.values()) {
      if (state.addresses.has(address)) return false
    }
    return true
  }

  const serverScoreUp = (uri: string, score: number): void => {
    pluginState.serverScoreUp(uri, score)
  }

  const getServerState = (uri: string): ServerState | undefined => {
    return serverStates.get(uri)
  }

  const getServerList = (): string[] => {
    return serverList
  }

  const setServerList = (updatedServerList: string[]): void => {
    serverList = updatedServerList
  }

  const broadcastTx = async (transaction: EdgeTransaction): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const uris = Object.keys(connections).filter(uri => {
        const blockBook = connections.get(uri)
        if (blockBook == null) return false
        return blockBook.isConnected
      })
      if (uris == null || uris.length < 1) {
        reject(
          new Error('No available connections\nCheck your internet signal')
        )
      }
      let resolved = false
      let bad = 0
      for (const uri of uris) {
        const blockBook = connections.get(uri)
        if (blockBook == null) continue
        blockBook
          .broadcastTx(transaction)
          .then(response => {
            if (!resolved) {
              resolved = true
              resolve(response.result)
            }
          })
          .catch((e?: Error) => {
            if (++bad === uris.length) {
              const msg = e != null ? `With error ${e.message}` : ''
              log.error(
                `broadcastTx fail: ${JSON.stringify(transaction)}\n${msg}`
              )
              reject(e)
            }
          })
      }
    })
  }

  const watchAddresses = (
    uri: string,
    addresses: string[],
    cb: WatchAddressesCB,
    deferredAddressSub: Deferred<unknown>
  ): void => {
    const blockbook = connections.get(uri)
    if (blockbook == null)
      throw new Error(`No blockbook connection with ${uri}`)
    blockbook.watchAddresses(addresses, cb, deferredAddressSub)
  }

  const watchBlocks = (
    uri: string,
    cb: WatchBlocksCB,
    deferredBlockSub: Deferred<unknown>
  ): void => {
    const blockbook = connections.get(uri)
    if (blockbook == null)
      throw new Error(`No blockbook connection with ${uri}`)
    blockbook.watchBlocks(cb, deferredBlockSub)
  }

  refillServers()

  return {
    setPickNextTaskCB,
    stop,
    serverCanGetTx,
    serverCanGetAddress,
    serverScoreUp,
    getServerState,
    refillServers,
    getServerList,
    setServerList,
    broadcastTx,
    watchAddresses,
    watchBlocks
  }
}
