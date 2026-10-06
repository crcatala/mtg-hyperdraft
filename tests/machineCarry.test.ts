import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/client/store";
import { cancelMachinePress, MACHINE_LAND_HOLD_MS, machineBeat, machineCarried, machinePos, machineTarget, pressMachine, resetMachineCarry } from "../src/client/table/machineCarry";
import { tableApi } from "../src/client/table/drag";
import { HOLD_MS, MOVE_PX } from "../src/client/table/petGesture";
import { receiveTreat, resetTreats } from "../src/client/table/treatShow";
import { matCenter } from "../src/shared/tableLayout";
import { machineSpot } from "../src/shared/treats";
import type { ClientMessage, RoomView } from "../src/shared/protocol";

/** A two-seat table: "me" (Alice) and "u2" (Bob). Only what the machine's carry reads. */
function seatTable(extra: Partial<RoomView> = {}) {
  const players = [
    { id: "me", name: "Alice" },
    { id: "u2", name: "Bob" },
  ];
  useStore.setState({ view: { you: "me", phase: "playing", players, table: { seats: ["me", "u2"], players: {} }, ...extra } as unknown as RoomView });
}

const sent: ClientMessage[] = [];
const classes = new Set<string>();
/** The screen maps 1:1 onto the table here: client (x, y) is table (x, y). */
const HOME = machineSpot(0, 2);
/** Open table: off every mat, well inside the rim. */
const OPEN = { x: HOME.x + 3, y: HOME.y - 2 };

describe("moving your Treatomancer (tap for the menu, hold or drag to carry it, land or nope)", () => {
  let win: EventTarget & { innerWidth: number; innerHeight: number };
  const fire = (type: string, pointerId: number, x = 0, y = 0) => win.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: x, clientY: y }));
  const key = (k: string) => win.dispatchEvent(Object.assign(new Event("keydown"), { key: k, preventDefault() {}, stopPropagation() {} }));
  let taps = 0;
  const tap = () => taps++;
  const press = (canMove = true, at = HOME) => pressMachine(canMove, { clientX: at.x, clientY: at.y, pointerId: 1 }, tap);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    vi.advanceTimersByTime(60_000);
    win = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { body: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) } } });
    classes.clear();
    sent.length = 0;
    taps = 0;
    useStore.setState({ sendImpl: (m) => sent.push(m) });
    tableApi.screenToTable = (x, y) => ({ x, y });
    seatTable();
    // The machine says where it's drawn; here, at its default spot.
    machinePos.x = HOME.x;
    machinePos.y = HOME.y;
  });
  afterEach(() => {
    resetTreats();
    resetMachineCarry();
    tableApi.screenToTable = () => null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useStore.setState({ view: null, sendImpl: () => {} });
  });

  it("a tap opens the menu and moves nothing", () => {
    press();
    fire("pointerup", 1, HOME.x, HOME.y);
    expect(taps).toBe(1);
    expect(machineCarried()).toBe(false);
    expect(sent).toEqual([]);
  });

  it("a hold lifts it; it follows the pointer from where it was grabbed; letting go on open table puts it there, stored", () => {
    press(true, { x: HOME.x + 0.5, y: HOME.y });
    vi.advanceTimersByTime(HOLD_MS);
    expect(machineCarried()).toBe(true);
    expect(machineBeat.kind).toBe("lift");
    expect(classes.has("dragging")).toBe(true);
    fire("pointermove", 1, OPEN.x + 0.5, OPEN.y);
    expect(machineTarget(HOME, undefined)).toEqual({ x: OPEN.x, y: OPEN.y, carried: true, invalid: false });
    fire("pointerup", 1, OPEN.x + 0.5, OPEN.y);
    expect(machineCarried()).toBe(false);
    expect(machineBeat.kind).toBe("land");
    expect(taps).toBe(0);
    expect(classes.has("dragging")).toBe(false);
    const at = { x: Math.round(OPEN.x * 100) / 100, y: Math.round(OPEN.y * 100) / 100 };
    expect(sent).toEqual([{ t: "setMachinePos", at }]);
    // It stays there until the state agrees (or the room never does, and the state wins).
    expect(machineTarget(HOME, undefined)).toMatchObject(at);
    vi.advanceTimersByTime(MACHINE_LAND_HOLD_MS + 1);
    expect(machineTarget(HOME, undefined)).toMatchObject({ x: HOME.x, y: HOME.y });
  });

  it("a drag lifts it straight away, however quick", () => {
    press();
    fire("pointermove", 1, HOME.x + MOVE_PX, HOME.y);
    expect(machineCarried()).toBe(true);
  });

  it("shows when it can't land (over a mat), and letting go there sends it back with a shake: nothing stored", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    const mat = matCenter(1, 2);
    fire("pointermove", 1, mat.x, mat.y);
    expect(machineTarget(HOME, undefined)).toMatchObject({ carried: true, invalid: true });
    fire("pointerup", 1, mat.x, mat.y);
    expect(machineCarried()).toBe(false);
    expect(machineBeat.kind).toBe("nope");
    expect(sent).toEqual([]);
    expect(machineTarget(HOME, undefined)).toEqual({ x: HOME.x, y: HOME.y, carried: false, invalid: false });
  });

  it("Esc puts it back", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    fire("pointermove", 1, OPEN.x, OPEN.y);
    key("Escape");
    expect(machineCarried()).toBe(false);
    expect(machineBeat.kind).toBe("nope");
    fire("pointerup", 1, OPEN.x, OPEN.y);
    expect(sent).toEqual([]);
  });

  it("someone else's machine (watching from their seat) only ever opens the menu", () => {
    press(false);
    vi.advanceTimersByTime(HOLD_MS * 2);
    fire("pointermove", 1, OPEN.x, OPEN.y);
    expect(machineCarried()).toBe(false);
    fire("pointerup", 1, OPEN.x, OPEN.y);
    expect(taps).toBe(1);
    expect(sent).toEqual([]);
  });

  it("can't be moved mid-show: a press is a tap (which says it's busy)", () => {
    seatTable({ showUntil: Date.now() + 10_000 });
    useStore.setState({ clockOffset: 0 });
    press();
    vi.advanceTimersByTime(HOLD_MS);
    expect(machineCarried()).toBe(false);
    fire("pointerup", 1, HOME.x, HOME.y);
    expect(taps).toBe(1);
  });

  it("a treat show starting mid-carry puts it back where it was (it fires from there)", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    fire("pointermove", 1, OPEN.x, OPEN.y);
    receiveTreat({ by: "u2", treat: "moonlit-macaron", seed: 1, at: { x: 0, y: 0 }, racers: [] });
    expect(machineCarried()).toBe(false);
    fire("pointerup", 1, OPEN.x, OPEN.y);
    expect(sent).toEqual([]);
    expect(classes.has("dragging")).toBe(false);
  });

  it("a show starting before the room took a just-landed move puts it back at once (the room turned the move away)", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    fire("pointermove", 1, OPEN.x, OPEN.y);
    fire("pointerup", 1, OPEN.x, OPEN.y);
    expect(machineTarget(HOME, undefined)).toMatchObject(OPEN);
    // Someone else's purchase got to the room first: the show arrives with the state still at home.
    receiveTreat({ by: "u2", treat: "moonlit-macaron", seed: 1, at: { x: 0, y: 0 }, racers: [] });
    expect(machineTarget(HOME, undefined)).toEqual({ x: HOME.x, y: HOME.y, carried: false, invalid: false });
    expect(machineBeat.kind).toBe("nope");
  });

  it("a move the room took before the purchase stays put when the show arrives", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    fire("pointermove", 1, OPEN.x, OPEN.y);
    fire("pointerup", 1, OPEN.x, OPEN.y);
    const at = (sent.at(-1) as { at: { x: number; y: number } }).at;
    // The room's state (sent right after it took the move) arrives first, then the show.
    seatTable({ table: { seats: ["me", "u2"], players: { me: { machineAt: at } } } } as unknown as Partial<RoomView>);
    receiveTreat({ by: "u2", treat: "moonlit-macaron", seed: 1, at: { x: 0, y: 0 }, racers: [] });
    expect(machineTarget(HOME, at)).toMatchObject(at);
    expect(machineBeat.kind).toBe("land");
  });

  it("can't be lifted without a seat", () => {
    useStore.setState({ view: { you: "me", phase: "playing", players: [{ id: "me", name: "Alice" }], table: { seats: ["u2"], players: {} } } as unknown as RoomView });
    press();
    vi.advanceTimersByTime(HOLD_MS);
    expect(machineCarried()).toBe(false);
    expect(classes.has("dragging")).toBe(false);
  });

  it("leaving the table mid-carry drops it and takes the grabbing cursor away", () => {
    press();
    vi.advanceTimersByTime(HOLD_MS);
    expect(classes.has("dragging")).toBe(true);
    resetMachineCarry();
    expect(machineCarried()).toBe(false);
    expect(classes.has("dragging")).toBe(false);
    cancelMachinePress();
    fire("pointerup", 1, OPEN.x, OPEN.y);
    expect(sent).toEqual([]);
  });
});
