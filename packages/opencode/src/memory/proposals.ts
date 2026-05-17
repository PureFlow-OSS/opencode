import { Effect, Context, Layer } from "effect"
import { InstanceState } from "@/effect"

export interface MemoryProposal {
  category: string
  content: string
  scope: string
  reason: string
  destination?: "sqlite" | "file"
  filePath?: string
  mode?: "write" | "append"
}

type State = {
  proposals: Map<string, MemoryProposal[]>
}

export interface Interface {
  readonly add: (sessionID: string, proposal: MemoryProposal) => Effect.Effect<void>
  readonly get: (sessionID: string) => Effect.Effect<MemoryProposal[]>
  readonly clear: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryProposals") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("MemoryProposals.state")(function* () {
        return { proposals: new Map<string, MemoryProposal[]>() }
      }),
    )

    const add = (sessionID: string, proposal: MemoryProposal) =>
      Effect.gen(function* () {
        const data = yield* InstanceState.get(state)
        const list = data.proposals.get(sessionID) ?? []
        data.proposals.set(sessionID, [...list, proposal])
      })

    const get = (sessionID: string) =>
      Effect.gen(function* () {
        const data = yield* InstanceState.get(state)
        return data.proposals.get(sessionID) ?? []
      })

    const clear = (sessionID: string) =>
      Effect.gen(function* () {
        const data = yield* InstanceState.get(state)
        data.proposals.delete(sessionID)
      })

    return Service.of({ add, get, clear })
  }),
)

export const defaultLayer = Layer.suspend(() => layer)

export * as MemoryProposals from "./proposals"
