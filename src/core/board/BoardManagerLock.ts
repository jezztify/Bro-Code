import * as fs from "fs/promises"
import * as path from "path"

import { v7 as uuidv7 } from "uuid"

import { safeWriteJson } from "../../utils/safeWriteJson"

/**
 * Where the claims live.
 *
 * Deliberately its own file rather than a field on `board.json`: a claim is refreshed
 * on a timer, and every board write fans out to each window's webview. Heartbeats
 * belong nowhere near that.
 */
export const BOARD_MANAGER_LOCK_FILE = "board-manager.lock.json"

/**
 * How long a claim outlives its last heartbeat before another host may take it over.
 * Three missed beats, so an extension host that is merely busy does not lose a board
 * it is in the middle of driving.
 */
export const BOARD_MANAGER_LOCK_STALE_MS = 60_000

/** How often a held claim is re-stamped, and re-checked against what is on disk. */
const HEARTBEAT_MS = 20_000

/** How long a refusal is trusted before the file is consulted again. */
const RECHECK_MS = 5_000

type BoardManagerClaim = { ownerId: string; at: number }
type BoardManagerClaims = Record<string, BoardManagerClaim>

const lockPath = (globalStoragePath: string) => path.join(globalStoragePath, BOARD_MANAGER_LOCK_FILE)

/** Whatever is on disk, reduced to claims that are actually usable. Never throws. */
const readClaims = async (globalStoragePath: string): Promise<BoardManagerClaims> => {
	let parsed: unknown
	try {
		parsed = JSON.parse(await fs.readFile(lockPath(globalStoragePath), "utf8"))
	} catch {
		// Missing, half-written, or corrupt: all mean "nobody holds anything", which is
		// the safe answer - the worst it costs is one host claiming a board afresh.
		return {}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {}
	}
	const claims: BoardManagerClaims = {}
	for (const [workspaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
		const { ownerId, at } = (value ?? {}) as Partial<BoardManagerClaim>
		if (typeof ownerId === "string" && ownerId && typeof at === "number" && Number.isFinite(at)) {
			claims[workspaceId] = { ownerId, at }
		}
	}
	return claims
}

const isLive = (claim: BoardManagerClaim | undefined): claim is BoardManagerClaim =>
	claim !== undefined && Date.now() - claim.at < BOARD_MANAGER_LOCK_STALE_MS

/**
 * Whether some extension host is currently driving this board workspace. Read straight
 * off disk, because the answer is about the other windows rather than about this one.
 */
export const isBoardManagerHeld = async (globalStoragePath: string, workspaceId: string): Promise<boolean> =>
	isLive((await readClaims(globalStoragePath))[workspaceId])

/**
 * Which extension host may drive a board workspace.
 *
 * Every VS Code window runs its own extension host, and so its own `BoardManager`, over
 * the same `board.json` - the autopilot switch is stored on the board, not per window.
 * Without a claim each of them acts on every enabled workspace, and they trip over each
 * other: two runs in the same folder, and a card started twice because the window that
 * acted second had not seen the first one's execution link yet.
 *
 * A claim is a lease rather than a lock. Nothing releases it if a window is killed, so
 * it is stamped with a heartbeat and expires; a host that goes quiet loses the board to
 * whichever window is still awake rather than parking it forever.
 */
export class BoardManagerLock {
	/** Workspaces this host believes it holds, so the common case costs no I/O. */
	private readonly held = new Set<string>()
	/** When each refused workspace was last checked, so a refusal is not re-read per tick. */
	private readonly refused = new Map<string, number>()
	private heartbeat?: ReturnType<typeof setInterval>
	private writeLock: Promise<void> = Promise.resolve()
	private disposed = false

	constructor(
		private readonly globalStoragePath: string,
		private readonly log: (message: string) => void = () => {},
		/** This extension host's identity. New on every launch: a claim never outlives one. */
		private readonly hostId: string = uuidv7(),
	) {}

	/**
	 * Whether this host may drive the workspace. Cheap to call on every pass: a claim
	 * already held is answered from memory, and a refusal is only re-checked against the
	 * file every {@link RECHECK_MS}.
	 */
	async claim(workspaceId: string): Promise<boolean> {
		if (this.disposed) return false
		if (this.held.has(workspaceId)) return true

		const refusedAt = this.refused.get(workspaceId)
		if (refusedAt !== undefined && Date.now() - refusedAt < RECHECK_MS) return false

		const written = await this.rewrite((claims) => {
			const claim = claims[workspaceId]
			if (isLive(claim) && claim.ownerId !== this.hostId) return false
			claims[workspaceId] = { ownerId: this.hostId, at: Date.now() }
			return true
		})
		// Read back rather than trusting the write: two hosts can find the same claim
		// expired at once, and only the one the file ends up naming may act.
		const won = written && (await readClaims(this.globalStoragePath))[workspaceId]?.ownerId === this.hostId
		if (!won || this.disposed) {
			this.refused.set(workspaceId, Date.now())
			return false
		}
		this.refused.delete(workspaceId)
		this.held.add(workspaceId)
		this.startHeartbeat()
		return true
	}

	/**
	 * Give up every claim outside `workspaceIds` - the manager was switched off for
	 * those boards, so another window should be free to pick them up without waiting
	 * out the lease.
	 */
	async retain(workspaceIds: Set<string>): Promise<void> {
		const dropped = [...this.held].filter((workspaceId) => !workspaceIds.has(workspaceId))
		for (const workspaceId of dropped) this.held.delete(workspaceId)
		for (const workspaceId of [...this.refused.keys()]) {
			if (!workspaceIds.has(workspaceId)) this.refused.delete(workspaceId)
		}
		if (this.held.size === 0) this.stopHeartbeat()
		if (dropped.length === 0) return

		await this.rewrite((claims) => {
			for (const workspaceId of dropped) {
				if (claims[workspaceId]?.ownerId === this.hostId) delete claims[workspaceId]
			}
			return true
		})
	}

	/** Drop everything and stop beating. The host is going away. */
	async dispose(): Promise<void> {
		this.disposed = true
		this.stopHeartbeat()
		await this.retain(new Set())
	}

	private startHeartbeat(): void {
		if (this.heartbeat || this.disposed) return
		this.heartbeat = setInterval(() => void this.refresh(), HEARTBEAT_MS)
		// The lease is a background formality; it must never hold the host open.
		this.heartbeat.unref?.()
	}

	private stopHeartbeat(): void {
		if (!this.heartbeat) return
		clearInterval(this.heartbeat)
		this.heartbeat = undefined
	}

	/**
	 * Re-stamp what this host holds, and let go of anything the file says belongs to
	 * someone else. That second half is what settles a claim two hosts made at the same
	 * moment: within a beat, only the one the file names is still acting.
	 */
	private async refresh(): Promise<void> {
		if (this.disposed || this.held.size === 0) return
		try {
			await this.rewrite((claims) => {
				for (const workspaceId of [...this.held]) {
					const claim = claims[workspaceId]
					if (isLive(claim) && claim.ownerId !== this.hostId) {
						this.log(`[BoardManagerLock] another window has taken over ${workspaceId}`)
						this.held.delete(workspaceId)
						continue
					}
					claims[workspaceId] = { ownerId: this.hostId, at: Date.now() }
				}
				return true
			})
		} catch (error) {
			// A heartbeat that could not be written is worth a log, not a thrown timer.
			this.log(`[BoardManagerLock] Unable to refresh the board manager claim: ${String(error)}`)
		}
		if (this.held.size === 0) this.stopHeartbeat()
	}

	/**
	 * Read, change, write. Serialized against this host's other writes; `safeWriteJson`
	 * takes an inter-process lock, which is what serializes it against the other windows.
	 */
	private async rewrite(mutator: (claims: BoardManagerClaims) => boolean): Promise<boolean> {
		const operation = this.writeLock.then(async () => {
			const claims = await readClaims(this.globalStoragePath)
			if (!mutator(claims)) return false
			await safeWriteJson(lockPath(this.globalStoragePath), claims)
			return true
		})
		this.writeLock = operation.then(
			() => undefined,
			() => undefined,
		)
		return operation
	}
}
