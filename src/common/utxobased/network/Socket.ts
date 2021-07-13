import { Cleaner } from 'cleaners'
import { EdgeLog } from 'edge-core-js'

import { removeItem } from '../../plugin/utils'
import Deferred from './Deferred'
import { SocketEmitter, SocketEvent } from './MakeSocketEmitter'
import { setupWS } from './nodejsWS'
import { pushUpdate, removeIdFromQueue } from './socketQueue'
import { InnerSocket, InnerSocketCallbacks, ReadyState } from './types'
import { setupBrowser } from './windowWS'

const TIMER_SLACK = 500
const KEEP_ALIVE_MS = 60000 // interval at which we keep the connection alive
const WAKE_UP_MS = 5000 // interval at which we wakeUp and potentially onQueueSpace

export type OnFailHandler = (error: Error) => void

export interface WsTask<T> {
  method: string
  params: unknown
  deferred: Deferred<T>
  cleaner?: Cleaner<T>
}

export interface WsSubscription<T> {
  method: string
  params: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (value: any) => void
  subscribed: boolean
  cleaner: Cleaner<T>
  deferred: Deferred<unknown>
}

export interface Socket {
  readyState: ReadyState
  connect: () => Promise<void>
  disconnect: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submitTask: (task: WsTask<any>) => void
  onQueueSpace: (cb: OnQueueSpaceCB) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe: (subscription: WsSubscription<any>) => void
  isConnected: () => boolean
}

export type OnQueueSpaceCB = (
  uri: string
) => Promise<WsTask<unknown> | boolean | undefined>

interface SocketConfig {
  queueSize?: number
  timeout?: number
  walletId: string
  emitter: SocketEmitter
  log: EdgeLog
  healthCheck: () => Promise<Record<string, unknown>> // function for heartbeat, should submit task itself
  onQueueSpaceCB: OnQueueSpaceCB
}

interface WsMessage {
  task: WsTask<unknown>
  startTime: number
}

interface Subscriptions {
  [key: string]: WsSubscription<unknown>
}

interface PendingMessages {
  [key: string]: WsMessage
}

export function makeSocket(uri: string, config: SocketConfig): Socket {
  let socket: InnerSocket | null
  const { emitter, log, queueSize = 50, walletId } = config
  log('makeSocket connects to', uri)
  const version = ''
  const subscriptions: Subscriptions = {}
  let onQueueSpace = config.onQueueSpaceCB
  let pendingMessages: PendingMessages = {}
  let nextId = 0
  let lastKeepAlive = 0
  let lastWakeUp = 0
  let connected = false
  let cancelConnect = false
  const timeout: number = 1000 * (config.timeout ?? 30)
  let error: Error | undefined
  let timer: NodeJS.Timeout

  const handleError = (e: Error): void => {
    if (error == null) error = e
    if (connected && socket != null && socket.readyState === ReadyState.OPEN)
      disconnect()
    else cancelConnect = true
    log.error('handled error!', e)
  }

  const disconnect = (): void => {
    log.warn('disconnecting from socket', uri)
    clearTimeout(timer)
    connected = false
    if (socket != null) socket.disconnect()
    removeIdFromQueue(uri)
  }

  const onSocketClose = (): void => {
    const err = error ?? new Error('Socket close')
    log.warn(`onSocketClose due to ${err.message} with server ${uri}`)
    clearTimeout(timer)
    connected = false
    socket = null
    cancelConnect = false
    for (const message of Object.values(pendingMessages)) {
      try {
        message.task.deferred.reject(err)
      } catch (e) {
        log.error(e.message)
      }
    }
    pendingMessages = {}
    try {
      emitter.emit(SocketEvent.CONNECTION_CLOSE, uri, err)
    } catch (e) {
      log.error(e.message)
    }
  }

  const onSocketConnect = (): void => {
    log(`onSocketConnect with server ${uri}`)
    if (cancelConnect) {
      if (socket != null) socket.disconnect()
      return
    }
    connected = true
    lastKeepAlive = Date.now()
    try {
      emitter.emit(SocketEvent.CONNECTION_OPEN, uri)
    } catch (e) {
      handleError(e)
    }
    for (const [id, message] of Object.entries(pendingMessages)) {
      transmitMessage(id, message)
    }

    wakeUp()
    cancelConnect = false
  }

  const wakeUp = (): void => {
    log(`wakeUp socket with server ${uri}`)
    pushUpdate({
      id: walletId + '==' + uri,
      updateFunc: () => {
        doWakeUp().catch(err => {
          throw new Error(`wake up error from: ${err.message}`)
        })
      }
    })
  }

  const doWakeUp = async (): Promise<void> => {
    log(`doWakeUp socket with server ${uri}`)
    lastWakeUp = Date.now()
    if (connected && version != null) {
      while (Object.keys(pendingMessages).length < queueSize) {
        const task = await onQueueSpace?.(uri)
        if (task == null) break
        if (typeof task === 'boolean') {
          if (task) continue
          break
        }
        submitTask(task)
      }
    }
  }

  // add any exception, since the passed in template parameter needs to be re-assigned
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscribe = (subscription: WsSubscription<any>): void => {
    if (socket != null && socket.readyState === ReadyState.OPEN && connected) {
      const id = subscription.method
      const message = {
        id,
        method: subscription.method,
        params: subscription.params ?? {}
      }
      subscriptions[id] = subscription
      socket.send(JSON.stringify(message))
    }
  }

  // add any exception, since the passed in template parameter needs to be re-assigned
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submitTask = (task: WsTask<any>): void => {
    const id = (nextId++).toString()
    const message = { task, startTime: Date.now() }
    pendingMessages[id] = message
    transmitMessage(id, message)
  }

  const transmitMessage = (id: string, pending: WsMessage): void => {
    const now = Date.now()
    if (
      socket != null &&
      socket.readyState === ReadyState.OPEN &&
      connected &&
      !cancelConnect
    ) {
      pending.startTime = now
      const message = {
        id,
        method: pending.task.method,
        params: pending.task.params ?? {}
      }
      socket.send(JSON.stringify(message))
    }
  }

  const onTimer = (): void => {
    log(`socket timer with server ${uri} expired, check if healthCheck needed`)
    const now = Date.now() - TIMER_SLACK
    if (lastKeepAlive + KEEP_ALIVE_MS < now) {
      log(`submitting healthCheck to server ${uri}`)
      lastKeepAlive = now
      config
        .healthCheck()
        .then(() => {
          emitter.emit(SocketEvent.CONNECTION_TIMER, uri, now)
        })
        .catch((e: Error) => handleError(e))
    }

    for (const [id, message] of Object.entries(pendingMessages)) {
      if (message.startTime + timeout < now) {
        try {
          message.task.deferred.reject(new Error('Timeout'))
        } catch (e) {
          log.error(e.message)
        }
        pendingMessages = removeItem(pendingMessages, id)
      }
    }
    wakeUp()
    setupTimer()
  }

  const setupTimer = (): void => {
    log(`setupTimer with server ${uri}`)
    let nextWakeUp = lastWakeUp + WAKE_UP_MS
    for (const message of Object.values(pendingMessages)) {
      const to = message.startTime + timeout
      if (to < nextWakeUp) nextWakeUp = to
    }

    const now = Date.now() - TIMER_SLACK
    const delay = nextWakeUp < now ? 0 : nextWakeUp - now
    timer = setTimeout(() => onTimer(), delay)
  }

  const onMessage = (messageJson: string): void => {
    try {
      const json = JSON.parse(messageJson)
      if (json.id != null) {
        const id: string = json.id.toString()
        for (const cId of Object.keys(subscriptions)) {
          if (id === cId) {
            const subscription = subscriptions[id]
            if (subscription == null) {
              throw new Error(`cannot find subscription for ${id}`)
            }
            if (json.data?.subscribed != null) {
              subscription.subscribed = true
              subscription.deferred.resolve(json.data)
              return
            }
            if (!subscription.subscribed) {
              subscription.deferred.reject()
            }
            if (subscription.cleaner != null) {
              subscription.cb(subscription.cleaner(json.data))
            } else {
              subscription.cb(json.data)
            }
            return
          }
        }
        const message = pendingMessages[id]
        if (message == null) {
          throw new Error(`Bad response id in ${messageJson}`)
        }
        pendingMessages = removeItem(pendingMessages, id)
        const { error } = json
        try {
          if (error != null) {
            const errorMessage =
              error.message != null ? error.message : error.connected
            throw new Error(errorMessage)
          }
          if (message.task.cleaner != null) {
            message.task.deferred.resolve(message.task.cleaner(json.data))
          } else {
            message.task.deferred.resolve(json.data)
          }
        } catch (e) {
          message.task.deferred.reject(e)
        }
      }
    } catch (e) {
      handleError(e)
    }
    wakeUp()
  }

  setupTimer()

  // return a Socket
  return {
    get readyState(): ReadyState {
      return socket?.readyState ?? ReadyState.CLOSED
    },

    async connect() {
      socket?.disconnect()

      return await new Promise<void>(resolve => {
        const cbs: InnerSocketCallbacks = {
          onOpen: () => {
            onSocketConnect()
            resolve()
          },
          onMessage: onMessage,
          onError: event => {
            error = new Error(JSON.stringify(event))
          },
          onClose: onSocketClose
        }

        try {
          socket = setupBrowser(uri, cbs)
        } catch {
          socket = setupWS(uri, cbs)
        }
      })
    },

    disconnect() {
      socket?.disconnect()
      socket = null
      disconnect()
    },

    isConnected(): boolean {
      return socket?.readyState === ReadyState.OPEN
    },

    submitTask(task: WsTask<unknown>): void {
      submitTask(task)
    },

    onQueueSpace(cb: OnQueueSpaceCB): void {
      onQueueSpace = cb
    },

    subscribe(subscription: WsSubscription<unknown>): void {
      subscribe(subscription)
    }
  }
}
