import { describe, it, expect, vi, beforeEach } from "vitest";
import { J2534Service } from "../services/J2534Service";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("J2534Service", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends security access physically when in functional mode", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "read_messages") {
        return [
          {
            id: 0x7e8,
            data: [0x67, 0x01, 0x12, 0x34],
            timestamp: 1,
            rx_status: 0,
            protocol_id: 0x07,
          },
        ];
      }
      return undefined;
    });

    const service = new J2534Service();
    await service.setAddressingMode("functional");
    const resp = await service.send("27 01");

    const sendCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "send_isotp"
    );

    expect(sendCall).toBeTruthy();
    expect(sendCall?.[1]?.id).toBe(0x7e0);
    expect(resp).toBe("67 01 12 34");
  });

  it("applies response filters for multiple IDs", async () => {
    const service = new J2534Service();
    await service.setResponseFilters(
      [
        { mask: 0x7ff, pattern: 0x7e8 },
        { mask: 0x7ff, pattern: 0x7e9 },
      ],
      [0x7e8, 0x7e9]
    );

    const filterCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "set_rx_filters"
    );

    expect(filterCalls.length).toBe(2);
  });
});
