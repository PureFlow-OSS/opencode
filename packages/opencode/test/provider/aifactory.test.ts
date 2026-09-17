import { expect, test } from "bun:test"
import { Provider } from "@/provider/provider"

test("keeps hidden OCR and vision workers addressable", () => {
  const models = Provider.aiFactoryModels(
    ["glm5.3", "GLM-OCR", "Qwen3-VL-4B"],
    "https://example.com/v1",
    [{ pattern: "glm5.3", document_ocr_model: "GLM-OCR", document_vision_model: "Qwen3-VL-4B" }],
    [
      { pattern: "GLM-OCR", visible: false },
      { pattern: "Qwen3-VL-4B", visible: false },
    ],
    ["glm5.3"],
  )

  expect(models["GLM-OCR"]).toBeDefined()
  expect(models["GLM-OCR"].capabilities.input.image).toBe(true)
  expect(models["Qwen3-VL-4B"]).toBeDefined()
  expect(models["Qwen3-VL-4B"].capabilities.input.image).toBe(true)
  expect(Object.keys(models)).toEqual(["glm5.3"])
})
