import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema, Stream } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TestEvent = {
  Ping: BusEvent.define("test.effect.ping", Schema.Struct({ value: Schema.Number })),
  Pong: BusEvent.define("test.effect.pong", Schema.Struct({ message: Schema.String })),
}

const node = CrossSpawnSpawner.defaultLayer

const live = Layer.mergeAll(Bus.layer, node)

const it = testEffect(live)

describe("Bus (Effect-native)", () => {
  it.live("publish + subscribe stream delivers events", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(yield* bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            received.push(evt.properties.value)
            if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Ping, { value: 2 })
        yield* Deferred.await(done)

        expect(received).toEqual([1, 2])
      }),
    ),
  )

  it.live("subscribe filters by event type", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const pings: number[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(yield* bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            pings.push(evt.properties.value)
            Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Pong, { message: "ignored" })
        yield* bus.publish(TestEvent.Ping, { value: 42 })
        yield* Deferred.await(done)

        expect(pings).toEqual([42])
      }),
    ),
  )

  it.live("subscribeAll receives all types", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const types: string[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(yield* bus.subscribeAll(), (evt) =>
          Effect.sync(() => {
            types.push(evt.type)
            if (types.length === 2) Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Pong, { message: "hi" })
        yield* Deferred.await(done)

        expect(types).toContain("test.effect.ping")
        expect(types).toContain("test.effect.pong")
      }),
    ),
  )

  it.live("multiple subscribers each receive the event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const a: number[] = []
        const b: number[] = []
        const doneA = yield* Deferred.make<void>()
        const doneB = yield* Deferred.make<void>()

        yield* Stream.runForEach(yield* bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            a.push(evt.properties.value)
            Deferred.doneUnsafe(doneA, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Stream.runForEach(yield* bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            b.push(evt.properties.value)
            Deferred.doneUnsafe(doneB, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 99 })
        yield* Deferred.await(doneA)
        yield* Deferred.await(doneB)

        expect(a).toEqual([99])
        expect(b).toEqual([99])
      }),
    ),
  )

  it.live("subscribeAll stream sees InstanceDisposed on disposal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const types: string[] = []
      const seen = yield* Deferred.make<void>()
      const disposed = yield* Deferred.make<void>()

      // Set up subscriber inside the instance
      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service

        yield* Stream.runForEach(yield* bus.subscribeAll(), (evt) =>
          Effect.sync(() => {
            types.push(evt.type)
            if (evt.type === TestEvent.Ping.type) Deferred.doneUnsafe(seen, Effect.void)
            if (evt.type === Bus.InstanceDisposed.type) Deferred.doneUnsafe(disposed, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(seen)
      }).pipe(provideInstance(dir))

      // Dispose from OUTSIDE the instance scope
      yield* Effect.promise(() => Instance.disposeAll())
      yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

      expect(types).toContain("test.effect.ping")
      expect(types).toContain(Bus.InstanceDisposed.type)
    }),
  )

  it.live("eager subscribe buffers publish before stream consumption starts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const stream = yield* bus.subscribe(TestEvent.Ping)

        yield* bus.publish(TestEvent.Ping, { value: 99 })

        const collected = yield* stream.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("400 millis"),
          Effect.option,
        )

        expect(collected._tag).toBe("Some")
        if (collected._tag === "Some") {
          const [event] = Array.from(collected.value)
          expect(event?.properties.value).toBe(99)
        }
      }),
    ),
  )

  it.live("eager subscribeAll survives concat prefix handoff", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const sawInitial = yield* Deferred.make<void>()
        const sawPublish = yield* Deferred.make<number>()
        const events = yield* bus.subscribeAll()

        yield* Stream.runForEach(
          Stream.make({ type: "server.connected", properties: {} }).pipe(Stream.concat(events)),
          (event) =>
            Effect.sync(() => {
              if (event.type === "server.connected") {
                Deferred.doneUnsafe(sawInitial, Effect.void)
                return
              }
              if (event.type === TestEvent.Ping.type) {
                const properties = event.properties as { value: number }
                Deferred.doneUnsafe(sawPublish, Effect.succeed(properties.value))
              }
            }),
        ).pipe(Effect.forkScoped)

        yield* Deferred.await(sawInitial).pipe(Effect.timeout("1 second"))
        yield* bus.publish(TestEvent.Ping, { value: 7 })

        const got = yield* Deferred.await(sawPublish).pipe(Effect.timeout("1 second"), Effect.option)
        expect(got._tag).toBe("Some")
        if (got._tag === "Some") expect(got.value).toBe(7)
      }),
    ),
  )
})
