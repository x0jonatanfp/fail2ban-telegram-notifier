// Tests del `BatchBuffer`: tope anti-crecimiento y drenado parcial.
import { describe, expect, it } from "vitest";
import { BatchBuffer, MAX_BATCH_BUFFER_EVENTS } from "../../src/domain/services/batch-buffer.ts";

describe("BatchBuffer", () => {
  it("descarta lo más antiguo (unbans primero) al superar el tope", () => {
    const buffer = new BatchBuffer();
    for (let i = 0; i < MAX_BATCH_BUFFER_EVENTS + 10; i += 1) {
      buffer.addBan(`10.0.0.${(i % 250) + 1}`, "postfix");
    }
    buffer.addUnban("9.9.9.9", "recidive");
    expect(buffer.size).toBe(MAX_BATCH_BUFFER_EVENTS);
    expect(buffer.droppedCount).toBe(11);
  });

  it("drain quita solo los N primeros y resetea droppedCount", () => {
    const buffer = new BatchBuffer();
    buffer.addBan("1.1.1.1", "postfix");
    buffer.addBan("2.2.2.2", "recidive");
    buffer.addUnban("3.3.3.3", "postfix");

    buffer.drain(1, 0);

    expect(buffer.snapshot()).toEqual({
      bans: [{ ip: "2.2.2.2", jail: "recidive" }],
      unbans: [{ ip: "3.3.3.3", jail: "postfix" }],
    });
    expect(buffer.droppedCount).toBe(0);
  });

  it("clear vacía y resetea droppedCount", () => {
    const buffer = new BatchBuffer();
    buffer.addBan("1.1.1.1", "postfix");
    buffer.clear();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.droppedCount).toBe(0);
  });
});
