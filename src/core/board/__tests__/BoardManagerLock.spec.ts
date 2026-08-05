import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import {
	BOARD_MANAGER_LOCK_FILE,
	BOARD_MANAGER_LOCK_STALE_MS,
	BoardManagerLock,
	isBoardManagerHeld,
} from "../BoardManagerLock"

const WORKSPACE_ID = "workspace-1"

const board = async () => mkdtemp(join(tmpdir(), "board-lock-"))

const readLock = async (directory: string) =>
	JSON.parse(await readFile(join(directory, BOARD_MANAGER_LOCK_FILE), "utf8"))

describe("BoardManagerLock", () => {
	it("lets the first host take a board and refuses the second", async () => {
		const directory = await board()
		const first = new BoardManagerLock(directory, () => {}, "host-1")
		const second = new BoardManagerLock(directory, () => {}, "host-2")

		expect(await first.claim(WORKSPACE_ID)).toBe(true)
		// The second window is running the same board over the same file. Acting here is
		// what starts a card twice.
		expect(await second.claim(WORKSPACE_ID)).toBe(false)

		await first.dispose()
		await second.dispose()
	})

	it("answers the same host again without another round trip to the file", async () => {
		const directory = await board()
		const lock = new BoardManagerLock(directory, () => {}, "host-1")

		expect(await lock.claim(WORKSPACE_ID)).toBe(true)
		// Overwritten behind its back: a claim it already holds is answered from memory,
		// and the heartbeat is what re-checks it.
		await writeFile(join(directory, BOARD_MANAGER_LOCK_FILE), "{}", "utf8")
		expect(await lock.claim(WORKSPACE_ID)).toBe(true)

		await lock.dispose()
	})

	it("takes over a board whose host has stopped beating", async () => {
		const directory = await board()
		await writeFile(
			join(directory, BOARD_MANAGER_LOCK_FILE),
			JSON.stringify({
				[WORKSPACE_ID]: { ownerId: "host-gone", at: Date.now() - BOARD_MANAGER_LOCK_STALE_MS - 1 },
			}),
			"utf8",
		)
		const lock = new BoardManagerLock(directory, () => {}, "host-1")

		// Nothing hands a claim back when a window is killed, so a lease that stopped
		// being refreshed has to expire or the board would be parked forever.
		expect(await lock.claim(WORKSPACE_ID)).toBe(true)
		expect((await readLock(directory))[WORKSPACE_ID].ownerId).toBe("host-1")

		await lock.dispose()
	})

	it("hands back a board that is no longer managed", async () => {
		const directory = await board()
		const first = new BoardManagerLock(directory, () => {}, "host-1")
		const second = new BoardManagerLock(directory, () => {}, "host-2")
		await first.claim(WORKSPACE_ID)

		await first.retain(new Set())

		expect(await readLock(directory)).toEqual({})
		// Freed immediately rather than after the lease runs out, so switching the
		// autopilot off in one window lets the next one pick it straight up.
		expect(await second.claim(WORKSPACE_ID)).toBe(true)

		await first.dispose()
		await second.dispose()
	})

	it("leaves another host's claims alone when it hands its own back", async () => {
		const directory = await board()
		const first = new BoardManagerLock(directory, () => {}, "host-1")
		const second = new BoardManagerLock(directory, () => {}, "host-2")
		await first.claim("workspace-a")
		await second.claim("workspace-b")

		await first.retain(new Set())

		expect(await readLock(directory)).toEqual({ "workspace-b": { ownerId: "host-2", at: expect.any(Number) } })

		await first.dispose()
		await second.dispose()
	})

	it("reports whether anyone is driving a board, for a window that has just opened", async () => {
		const directory = await board()
		const lock = new BoardManagerLock(directory, () => {}, "host-1")

		expect(await isBoardManagerHeld(directory, WORKSPACE_ID)).toBe(false)
		await lock.claim(WORKSPACE_ID)
		expect(await isBoardManagerHeld(directory, WORKSPACE_ID)).toBe(true)

		await lock.dispose()
	})

	it("treats an unreadable lock file as nobody holding anything", async () => {
		const directory = await board()
		await writeFile(join(directory, BOARD_MANAGER_LOCK_FILE), "{ not json", "utf8")

		expect(await isBoardManagerHeld(directory, WORKSPACE_ID)).toBe(false)

		const lock = new BoardManagerLock(directory, () => {}, "host-1")
		expect(await lock.claim(WORKSPACE_ID)).toBe(true)
		await lock.dispose()
	})
})
