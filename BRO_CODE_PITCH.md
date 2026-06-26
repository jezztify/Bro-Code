# Bro Code: The Bro that helps AIs work like bros

## The problem

LLMs are great at single tasks. They're bad at following a _workflow_ — plan, then code, then test, then debug, each step needing different judgment. Ask one model to do all of it in one go and it cuts corners or loses the thread.

## The idea

Don't make one LLM do everything. Put multiple LLMs together, each playing a specific role (Architect, Code, Debug, etc.), and have an **Orchestrator** break the work into steps and hand each step to the right one — like a team, not a single overworked employee.

## Why it works

- **Right tool for the step.** Planning needs a different mindset than writing code, which needs a different mindset than debugging. Specialized modes do their one job well instead of one model doing all jobs poorly.
- **The orchestrator keeps the workflow honest.** It decides what happens next and routes to the right mode — the workflow lives in the orchestration layer, not in hoping one model remembers the plan.
- **It's already built in.** Bro Code (a fork of Zoo Code/Roo Code) ships this as Orchestrator mode with delegated subtasks today — it's not a future idea, it's something we can try this week.

## The ask

Try a real multi-step task through Orchestrator mode and see where the handoffs break down — that's the feedback that makes this actually reliable.
