import EventEmitter from "events"

export type BroTerminalProvider = "vscode" | "execa"

export interface BroTerminal {
	provider: BroTerminalProvider
	id: number
	reuseKey: string
	busy: boolean
	running: boolean
	taskId?: string
	process?: BroTerminalProcess
	getCurrentWorkingDirectory(): string
	isClosed: () => boolean
	runCommand: (command: string, callbacks: BroTerminalCallbacks) => BroTerminalProcessResultPromise
	setActiveStream(stream: AsyncIterable<string> | undefined, pid?: number): void
	shellExecutionComplete(exitDetails: ExitCodeDetails): void
	getProcessesWithOutput(): BroTerminalProcess[]
	getUnretrievedOutput(): string
	getLastCommand(): string
	cleanCompletedProcessQueue(): void
}

export interface BroTerminalCallbacks {
	onLine: (line: string, process: BroTerminalProcess) => void
	onCompleted: (output: string | undefined, process: BroTerminalProcess) => void | Promise<void>
	onShellExecutionStarted: (pid: number | undefined, process: BroTerminalProcess) => void
	onShellExecutionComplete: (details: ExitCodeDetails, process: BroTerminalProcess) => void
	onNoShellIntegration?: (details: ShellIntegrationErrorDetails, process: BroTerminalProcess) => void
}

export interface ShellIntegrationErrorDetails {
	message: string
	commandSubmitted: boolean
}

export class ShellIntegrationError extends Error {
	constructor(
		message: string,
		public readonly commandSubmitted: boolean,
	) {
		super(message)
	}
}

export interface BroTerminalProcess extends EventEmitter<BroTerminalProcessEvents> {
	command: string
	isHot: boolean
	run: (command: string) => Promise<void>
	continue: () => void
	abort: () => void
	hasUnretrievedOutput: () => boolean
	getUnretrievedOutput: () => string
	trimRetrievedOutput: () => void
}

export type BroTerminalProcessResultPromise = BroTerminalProcess & Promise<void>

export interface BroTerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [output?: string]
	stream_available: [stream: AsyncIterable<string>]
	shell_execution_started: [pid: number | undefined]
	shell_execution_complete: [exitDetails: ExitCodeDetails]
	error: [error: Error]
	no_shell_integration: [details: ShellIntegrationErrorDetails]
}

export interface ExitCodeDetails {
	exitCode: number | undefined
	signal?: number | undefined
	signalName?: string
	coreDumpPossible?: boolean
}
