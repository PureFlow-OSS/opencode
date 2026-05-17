import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { MemoryService } from "@/memory/service"
import { MemoryExport } from "@/memory/export"
import { errors } from "../../error"

const EntrySchema = MemoryService.Entry.zod
const AddInputSchema = MemoryService.AddInput.zod

export const MemoryRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List memories",
        description: "List saved memories, optionally filtered by scope and category.",
        operationId: "memory.list",
        responses: {
          200: {
            description: "List of memories",
            content: { "application/json": { schema: resolver(EntrySchema.array()) } },
          },
        },
      }),
      validator(
        "query",
        z.object({
          scope: z.string().optional(),
          category: z.string().optional(),
          page: z.coerce.number().optional(),
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("MemoryRoutes.list", c, function* () {
          const svc = yield* MemoryService.Service
          const { scope, category, page = 1, limit = 100 } = c.req.valid("query")
          const all = yield* svc.list(scope, category)
          const start = (page - 1) * limit
          return all.slice(start, start + limit)
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create memory",
        description: "Save a new memory entry.",
        operationId: "memory.create",
        responses: {
          200: {
            description: "Created memory",
            content: { "application/json": { schema: resolver(EntrySchema) } },
          },
          ...errors(400),
        },
      }),
      validator("json", AddInputSchema),
      async (c) =>
        jsonRequest("MemoryRoutes.create", c, function* () {
          const svc = yield* MemoryService.Service
          return yield* svc.add(c.req.valid("json"))
        }),
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Update memory",
        description: "Update the content of an existing memory. Previous value is preserved.",
        operationId: "memory.update",
        responses: {
          200: {
            description: "Updated memory",
            content: { "application/json": { schema: resolver(EntrySchema) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ content: z.string() })),
      async (c) =>
        jsonRequest("MemoryRoutes.update", c, function* () {
          const svc = yield* MemoryService.Service
          return yield* svc.update(c.req.param("id"), c.req.valid("json").content)
        }),
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete memory",
        description: "Permanently delete a memory by ID.",
        operationId: "memory.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(404),
        },
      }),
      async (c) =>
        jsonRequest("MemoryRoutes.delete", c, function* () {
          const svc = yield* MemoryService.Service
          yield* svc.remove(c.req.param("id"))
          return true
        }),
    )
    .get(
      "/export",
      describeRoute({
        summary: "Export memories",
        description: "Download all memories as a JSON file, optionally filtered by scope.",
        operationId: "memory.export",
        responses: {
          200: {
            description: "JSON export",
            content: { "application/json": { schema: resolver(z.array(z.any())) } },
          },
        },
      }),
      validator("query", z.object({ scope: z.string().optional() })),
      async (c) => {
        const { scope } = c.req.valid("query")
        const entries = MemoryExport.exportEntries(scope)
        return c.json(entries)
      },
    )
    .post(
      "/import",
      describeRoute({
        summary: "Import memories",
        description: "Import memories from a previously exported JSON array.",
        operationId: "memory.import",
        responses: {
          200: {
            description: "Number of imported entries",
            content: { "application/json": { schema: resolver(z.object({ imported: z.number() })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", z.array(z.any())),
      async (c) => {
        const entries = c.req.valid("json")
        const imported = MemoryExport.importEntries(entries)
        return c.json({ imported })
      },
    ),
)
