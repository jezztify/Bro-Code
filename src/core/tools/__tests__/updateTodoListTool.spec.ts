import { describe, it, expect, beforeEach, vi } from "vitest"
import {
	parseMarkdownChecklist,
	todoListToMarkdownWithIds,
	canTransitionTodoStatus,
	updateTodoStatusForTask,
} from "../UpdateTodoListTool"
import { TodoItem } from "@roo-code/types"
import type { Task } from "../../task/Task"

describe("parseMarkdownChecklist", () => {
	describe("standard checkbox format (without dash prefix)", () => {
		it("should parse pending tasks", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with lowercase x", () => {
			const md = `[x] Completed task 1
[x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with uppercase X", () => {
			const md = `[X] Completed task 1
[X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash", () => {
			const md = `[-] In progress task 1
[-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("should parse in-progress tasks with tilde", () => {
			const md = `[~] In progress task 1
[~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("dash-prefixed checkbox format", () => {
		it("should parse pending tasks with dash prefix", () => {
			const md = `- [ ] Task 1
- [ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with dash prefix and lowercase x", () => {
			const md = `- [x] Completed task 1
- [x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with dash prefix and uppercase X", () => {
			const md = `- [X] Completed task 1
- [X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash prefix and dash marker", () => {
			const md = `- [-] In progress task 1
- [-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("should parse in-progress tasks with dash prefix and tilde marker", () => {
			const md = `- [~] In progress task 1
- [~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("mixed formats", () => {
		it("should parse mixed formats correctly", () => {
			const md = `[ ] Task without dash
- [ ] Task with dash
[x] Completed without dash
- [X] Completed with dash
[-] In progress without dash
- [~] In progress with dash`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(6)

			expect(result[0].content).toBe("Task without dash")
			expect(result[0].status).toBe("pending")

			expect(result[1].content).toBe("Task with dash")
			expect(result[1].status).toBe("pending")

			expect(result[2].content).toBe("Completed without dash")
			expect(result[2].status).toBe("completed")

			expect(result[3].content).toBe("Completed with dash")
			expect(result[3].status).toBe("completed")

			expect(result[4].content).toBe("In progress without dash")
			expect(result[4].status).toBe("in_progress")

			expect(result[5].content).toBe("In progress with dash")
			expect(result[5].status).toBe("in_progress")
		})
	})

	describe("edge cases", () => {
		it("should handle empty strings", () => {
			const result = parseMarkdownChecklist("")
			expect(result).toEqual([])
		})

		it("should handle non-string input", () => {
			const result = parseMarkdownChecklist(null as any)
			expect(result).toEqual([])
		})

		it("should handle undefined input", () => {
			const result = parseMarkdownChecklist(undefined as any)
			expect(result).toEqual([])
		})

		it("should ignore non-checklist lines", () => {
			const md = `This is not a checklist
[ ] Valid task
Just some text
- Not a checklist item
- [x] Valid completed task
[not valid] Invalid format`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Valid task")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Valid completed task")
			expect(result[1].status).toBe("completed")
		})

		it("should handle extra spaces", () => {
			const md = `  [ ]   Task with spaces  
-  [ ]  Task with dash and spaces
  [x]  Completed with spaces
-   [X]   Completed with dash and spaces`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(4)
			expect(result[0].content).toBe("Task with spaces")
			expect(result[1].content).toBe("Task with dash and spaces")
			expect(result[2].content).toBe("Completed with spaces")
			expect(result[3].content).toBe("Completed with dash and spaces")
		})

		it("should handle Windows line endings", () => {
			const md = "[ ] Task 1\r\n- [x] Task 2\r\n[-] Task 3"
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(3)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("completed")
			expect(result[2].content).toBe("Task 3")
			expect(result[2].status).toBe("in_progress")
		})
	})

	describe("ID generation", () => {
		it("should generate consistent IDs for the same content and status", () => {
			const md1 = `[ ] Task 1
[x] Task 2`
			const md2 = `[ ] Task 1
[x] Task 2`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)

			expect(result1[0].id).toBe(result2[0].id)
			expect(result1[1].id).toBe(result2[1].id)
		})

		it("should generate different IDs for different content", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).not.toBe(result[1].id)
		})

		it("should generate the same id for same content regardless of status", () => {
			// Ids are now derived from normalized content only (not status), so an item's id
			// stays stable across update_todo_list calls that change its status. This is what
			// allows a kanban board card to keep its identity (and relatedTaskId link) as the
			// linked todo moves through pending -> in_progress -> testing -> completed.
			const md = `[ ] Task 1
[x] Task 1`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).toBe(result[1].id)
		})

		it("should generate the same id regardless of case or surrounding whitespace", () => {
			const md1 = `[ ] Task 1`
			const md2 = `[ ]   task 1  `
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)
			expect(result1[0].id).toBe(result2[0].id)
		})

		it("should generate same IDs regardless of dash prefix", () => {
			const md1 = `[ ] Task 1`
			const md2 = `- [ ] Task 1`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)
			expect(result1[0].id).toBe(result2[0].id)
		})
	})

	describe("testing status ([t]/[T])", () => {
		it("should parse lowercase t as testing", () => {
			const md = `[t] Task 1`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(1)
			expect(result[0].status).toBe("testing")
		})

		it("should parse uppercase T as testing", () => {
			const md = `- [T] Task 1`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(1)
			expect(result[0].status).toBe("testing")
		})
	})
})

describe("todoListToMarkdownWithIds", () => {
	it("should render each item with its id and status checkbox", () => {
		const todos = parseMarkdownChecklist(`[ ] Task 1
[-] Task 2
[t] Task 3
[x] Task 4`)
		const md = todoListToMarkdownWithIds(todos)
		const lines = md.split("\n")
		expect(lines).toHaveLength(4)
		expect(lines[0]).toBe(`- [ ] (id: ${todos[0].id}) Task 1`)
		expect(lines[1]).toBe(`- [-] (id: ${todos[1].id}) Task 2`)
		expect(lines[2]).toBe(`- [t] (id: ${todos[2].id}) Task 3`)
		expect(lines[3]).toBe(`- [x] (id: ${todos[3].id}) Task 4`)
	})
})

describe("canTransitionTodoStatus", () => {
	it("allows a status to transition to itself regardless of source", () => {
		expect(canTransitionTodoStatus("pending", "pending", "manual")).toBe(true)
		expect(canTransitionTodoStatus("in_progress", "in_progress", "auto")).toBe(true)
	})

	it("allows pending -> in_progress only via manual", () => {
		expect(canTransitionTodoStatus("pending", "in_progress", "manual")).toBe(true)
		expect(canTransitionTodoStatus("pending", "in_progress", "auto")).toBe(false)
	})

	it("allows in_progress -> testing via auto (delegated subtask completed) or manual (self-testing)", () => {
		expect(canTransitionTodoStatus("in_progress", "testing", "auto")).toBe(true)
		expect(canTransitionTodoStatus("in_progress", "testing", "manual")).toBe(true)
	})

	it("allows in_progress -> completed only via manual (most items are never delegated)", () => {
		expect(canTransitionTodoStatus("in_progress", "completed", "manual")).toBe(true)
		expect(canTransitionTodoStatus("in_progress", "completed", "auto")).toBe(false)
	})

	it("allows testing -> completed and testing -> in_progress only via manual", () => {
		expect(canTransitionTodoStatus("testing", "completed", "manual")).toBe(true)
		expect(canTransitionTodoStatus("testing", "completed", "auto")).toBe(false)
		expect(canTransitionTodoStatus("testing", "in_progress", "manual")).toBe(true)
		expect(canTransitionTodoStatus("testing", "in_progress", "auto")).toBe(false)
	})

	it("allows in_progress -> pending via manual (agent recovers a stalled delegation) or auto (abandonSubtask)", () => {
		expect(canTransitionTodoStatus("in_progress", "pending", "manual")).toBe(true)
		expect(canTransitionTodoStatus("in_progress", "pending", "auto")).toBe(true)
	})

	it("rejects illegal transitions such as pending -> testing and pending -> completed", () => {
		expect(canTransitionTodoStatus("pending", "testing", "manual")).toBe(false)
		expect(canTransitionTodoStatus("pending", "testing", "auto")).toBe(false)
		expect(canTransitionTodoStatus("pending", "completed", "manual")).toBe(false)
		expect(canTransitionTodoStatus("pending", "completed", "auto")).toBe(false)
	})

	it("rejects completed -> testing (terminal state)", () => {
		expect(canTransitionTodoStatus("completed", "testing", "manual")).toBe(false)
		expect(canTransitionTodoStatus("completed", "testing", "auto")).toBe(false)
	})
})

describe("updateTodoStatusForTask", () => {
	function makeTask(todoList: TodoItem[]) {
		return { todoList } as unknown as Task
	}

	it("applies a legal manual transition", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "pending" }])
		const result = updateTodoStatusForTask(task, "1", "in_progress", "manual")
		expect(result).toBe(true)
		expect(task.todoList![0].status).toBe("in_progress")
	})

	it("applies a legal auto transition", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "in_progress", relatedTaskId: "child-1" }])
		const result = updateTodoStatusForTask(task, "1", "testing", "auto")
		expect(result).toBe(true)
		expect(task.todoList![0].status).toBe("testing")
		// relatedTaskId must survive the transition
		expect(task.todoList![0].relatedTaskId).toBe("child-1")
	})

	it("rejects an illegal transition and leaves the todo unchanged", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "pending" }])
		const result = updateTodoStatusForTask(task, "1", "testing", "manual")
		expect(result).toBe(false)
		expect(task.todoList![0].status).toBe("pending")
	})

	it("allows in_progress -> testing via manual source (self-testing, no delegation involved)", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "in_progress" }])
		const result = updateTodoStatusForTask(task, "1", "testing", "manual")
		expect(result).toBe(true)
		expect(task.todoList![0].status).toBe("testing")
	})

	it("allows in_progress -> completed via manual source (item was never delegated)", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "in_progress" }])
		const result = updateTodoStatusForTask(task, "1", "completed", "manual")
		expect(result).toBe(true)
		expect(task.todoList![0].status).toBe("completed")
	})

	it("resets in_progress -> pending and clears relatedTaskId (stalled delegation recovery)", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "in_progress", relatedTaskId: "dead-child" }])
		const result = updateTodoStatusForTask(task, "1", "pending", "manual")
		expect(result).toBe(true)
		expect(task.todoList![0].status).toBe("pending")
		expect(task.todoList![0].relatedTaskId).toBeUndefined()
	})

	it("returns false for an unknown id", () => {
		const task = makeTask([{ id: "1", content: "Task 1", status: "pending" }])
		const result = updateTodoStatusForTask(task, "missing-id", "in_progress", "manual")
		expect(result).toBe(false)
	})
})
