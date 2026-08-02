import * as vscode from "vscode"

import { WORKSPACE_STATE_KEYS, isWorkspaceScopedStateKey, type GlobalState } from "@roo-code/types"

import { logger } from "../../utils/logging"

type GlobalStateKey = keyof GlobalState

/**
 * Marker written to `workspaceState` once a workspace has inherited the global settings.
 * Not a user setting, so it deliberately lives outside of `GlobalState`.
 */
export const WORKSPACE_SETTINGS_SEEDED_KEY = "workspaceSettingsSeeded"

/**
 * Settings are stored per-workspace, with a small deny-list of keys that stay global
 * (see `ALWAYS_GLOBAL_STATE_KEYS`). These helpers are the single place that decides which
 * store a key belongs to, so call sites that only hold a raw `ExtensionContext` route
 * writes to the same place `ContextProxy` reads them from.
 */

export function readScopedState<T>(context: vscode.ExtensionContext, key: GlobalStateKey): T | undefined {
	if (!isWorkspaceScopedStateKey(key)) {
		return context.globalState.get<T>(key)
	}

	// Fall back to the global value so keys written before this workspace was seeded
	// (or by an older version of the extension) still resolve.
	const workspaceValue = context.workspaceState.get<T>(key)
	return workspaceValue !== undefined ? workspaceValue : context.globalState.get<T>(key)
}

export function writeScopedState(
	context: vscode.ExtensionContext,
	key: GlobalStateKey,
	value: unknown,
): Thenable<void> {
	return isWorkspaceScopedStateKey(key)
		? context.workspaceState.update(key, value)
		: context.globalState.update(key, value)
}

/**
 * Copies the current global values into this workspace the first time it is opened with a build
 * that supports per-workspace settings. Existing users therefore see no change; from this point on
 * the workspace's settings evolve independently of every other workspace.
 */
export async function seedWorkspaceSettings(context: vscode.ExtensionContext): Promise<void> {
	if (context.workspaceState.get<boolean>(WORKSPACE_SETTINGS_SEEDED_KEY)) {
		return
	}

	try {
		for (const key of WORKSPACE_STATE_KEYS) {
			const globalValue = context.globalState.get(key)

			if (globalValue !== undefined && context.workspaceState.get(key) === undefined) {
				await context.workspaceState.update(key, globalValue)
			}
		}

		await context.workspaceState.update(WORKSPACE_SETTINGS_SEEDED_KEY, true)
	} catch (error) {
		logger.error(
			`Error seeding workspace settings from global state: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}
