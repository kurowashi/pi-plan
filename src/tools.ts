/**
 * The two model-facing tools.
 *
 * Pi has no permission-prompt layer, so the consent and approval dialogs live
 * here. The exit result carries the plan text back so the model can start
 * implementing without a second read, as in Claude Code.
 */

import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readPlan, writePlan } from "./plans.ts";
import type { PlanModeSnapshot } from "./state.ts";

const ENTER_PLAN_MODE_TOOL = "enter_plan_mode";
const EXIT_PLAN_MODE_TOOL = "exit_plan_mode";

const ENTER_APPROVAL = "Yes, enter plan mode";
const DECLINE_ENTRY = "No, start implementing now";
const EXECUTE_APPROVAL = "Yes, execute the plan";
const EDIT_APPROVAL = "Edit the plan, then execute";
const CONTINUE_APPROVAL = "No, keep planning";

/** Shared by both tools: approving is impossible without a dialog. */
const NO_UI_REASON =
	"no dialog-capable UI is available in this mode (print or JSON), so the request cannot be shown to the user";

export interface PlanModeHooks {
	snapshot(): PlanModeSnapshot | undefined;
	planFilePath(): string;
	enter(ctx: ExtensionContext): void;
	exit(ctx: ExtensionContext): void;
}

function text(content: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text: content }], details: undefined };
}

const ENTER_DESCRIPTION = `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using enter_plan_mode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
2. **Multiple Valid Approaches**: The task can be solved in several different ways
3. **Code Modifications**: Changes that affect existing behavior or structure
4. **Architectural Decisions**: The task requires choosing between patterns or technologies
5. **Multi-File Changes**: The task will likely touch more than 2-3 files
6. **Unclear Requirements**: You need to explore before understanding the full scope
7. **User Preferences Matter**: If you would ask your question tool to clarify the approach, use enter_plan_mode instead

## When NOT to Use This Tool

Only skip enter_plan_mode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using read-only tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Ask the user clarifying questions when the approach is ambiguous
6. Exit plan mode with exit_plan_mode when ready to implement

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work`;

const EXIT_DESCRIPTION = `Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, ask the user first
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT ask "Is this plan okay?" or "Should I proceed?" via text or your question tool - that is exactly what THIS tool does. exit_plan_mode inherently requests user approval of your plan.`;

export function createPlanModeTools(hooks: PlanModeHooks): [ToolDefinition, ToolDefinition] {
	const enter: ToolDefinition = {
		name: ENTER_PLAN_MODE_TOOL,
		label: "Enter plan mode",
		description: ENTER_DESCRIPTION,
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (hooks.snapshot()?.active === true) {
				return text(
					`Already in plan mode. Continue exploring and write your plan to ${hooks.planFilePath()} before calling ${EXIT_PLAN_MODE_TOOL}.`,
				);
			}
			if (!ctx.hasUI) {
				return text(`Plan mode was not entered: ${NO_UI_REASON}. Continue with the task directly.`);
			}
			const choice = await ctx.ui.select("Enter plan mode?", [ENTER_APPROVAL, DECLINE_ENTRY]);
			if (choice !== ENTER_APPROVAL) {
				return text("The user declined plan mode. Continue with the task directly.");
			}
			hooks.enter(ctx);
			return text(`Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Ask the user clarifying questions when they matter
5. Design a concrete implementation strategy
6. When ready, use ${EXIT_PLAN_MODE_TOOL} to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`);
		},
	};

	const exit: ToolDefinition = {
		name: EXIT_PLAN_MODE_TOOL,
		label: "Exit plan mode",
		description: EXIT_DESCRIPTION,
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const snapshot = hooks.snapshot();
			if (snapshot?.active !== true) {
				return text(
					"You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.",
				);
			}
			if (!ctx.hasUI) {
				return text(
					`The plan was not reviewed: ${NO_UI_REASON}. Keep planning, or ask the user to approve from an interactive session.`,
				);
			}
			const path = hooks.planFilePath();
			const plan = readPlan(path) ?? "";
			const choice = await ctx.ui.select("Exit plan mode?", [EXECUTE_APPROVAL, EDIT_APPROVAL, CONTINUE_APPROVAL]);
			if (choice !== EXECUTE_APPROVAL && choice !== EDIT_APPROVAL) {
				return text(await rejectionText(ctx));
			}
			hooks.exit(ctx);
			if (choice === EDIT_APPROVAL) {
				return text(await editedApprovalText(ctx, path, plan));
			}
			return text(approvedPlanText(path, plan, false));
		},
	};

	return [enter, exit];
}

async function rejectionText(ctx: ExtensionContext): Promise<string> {
	const feedback = (await ctx.ui.input("What should change in the plan?")) ?? "";
	return `The user rejected the plan and wants changes before executing it. Keep planning and revise the plan file.

User feedback: ${feedback}

When the plan is ready, call ${EXIT_PLAN_MODE_TOOL} again.`;
}

async function editedApprovalText(ctx: ExtensionContext, path: string, plan: string): Promise<string> {
	const edited = (await ctx.ui.editor("Edit the plan", plan)) ?? plan;
	const editedByUser = edited !== plan;
	if (editedByUser) writePlan(path, edited);
	return approvedPlanText(path, edited, editedByUser);
}

function approvedPlanText(path: string, plan: string, editedByUser: boolean): string {
	if (plan.trim() === "") {
		return "User has approved exiting plan mode. You can now proceed.";
	}
	const label = editedByUser ? "Approved Plan (edited by user)" : "Approved Plan";
	return `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${path}
You can refer back to it if needed during implementation.

## ${label}:
${plan}`;
}
