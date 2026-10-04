/**
 * The text injected into the model's context while plan mode is active.
 *
 * The wording follows Claude Code v2.1.88. Substitutions are limited to what pi
 * names differently: the plan tools, the file tools, and the question tool,
 * which pi has no standard name for and is therefore described generically.
 */

export function buildFullInstructions(planFilePath: string, planExists: boolean): string {
	const planFileInfo = planExists
		? `A plan file already exists at ${planFilePath}. You can read it and make incremental edits using the \`edit\` tool.`
		: `No plan file exists yet. You should create your plan at ${planFilePath} using the \`write\` tool.`;

	return `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${planFileInfo}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Use read-only tools (the \`read\` tool and \`grep\`, \`find\`, \`ls\` through Bash) and, when available, sub-agents to explore in parallel.

1. Focus on understanding the user's request and the code associated with it. Actively search for existing functions, utilities, and patterns that can be reused -- avoid proposing new code when suitable implementations already exist.
2. Prefer a sub-agent for exploration when the scope is uncertain or several areas of the codebase are involved, and explore directly when the task is isolated to known files.
3. Quality over quantity: use the minimum number of sub-agents necessary, usually just one.

### Phase 2: Design
Goal: Design an implementation approach.

When a sub-agent is available, give it the exploration results, the requirements, and the constraints, and request a detailed implementation plan. For a truly trivial task (a typo, a one-line change), design it directly.

### Phase 3: Review
Goal: Review the design and ensure alignment with the user's intentions.

1. Read the critical files identified during exploration to deepen your understanding.
2. Ensure that the design addresses the user's original request.
3. Use your question tool to clarify any remaining questions with the user.

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Begin with a **Context** section: explain why this change is being made -- the problem or need it addresses, what prompted it, and the intended outcome
- Include only your recommended approach, not all alternatives
- Ensure the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Reference existing functions and utilities you found that should be reused, with their file paths
- Include a verification section describing how to test the changes end-to-end (run the code, run tests)

### Phase 5: Call exit_plan_mode
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call exit_plan_mode to indicate to the user that you are done planning.
This is critical - your turn should only end with either using your question tool OR calling exit_plan_mode. Do not stop unless it is for these 2 reasons

**Important:** Use your question tool ONLY to clarify requirements or choose between approaches. Use exit_plan_mode to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no question tool. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use exit_plan_mode.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using your question tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.`;
}

export function buildSparseInstructions(planFilePath: string): string {
	return `Plan mode still active (see full instructions earlier in conversation). Read-only except plan file (${planFilePath}). Follow the 5-phase workflow. End turns with your question tool (for clarifications) or exit_plan_mode (for plan approval). Never ask about plan approval via text or a question tool.`;
}

export function buildReentryInstructions(planFilePath: string): string {
	return `## Re-entering Plan Mode

You are returning to plan mode after having previously exited it. A plan file exists at ${planFilePath} from your previous planning session.

**Before proceeding with any new planning, you should:**
1. Read the existing plan file to understand what was previously planned
2. Evaluate the user's current request against that plan
3. Decide how to proceed:
   - **Different task**: If the user's request is for a different task -- even if it is similar or related -- start fresh by overwriting the existing plan
   - **Same task, continuing**: If this is explicitly a continuation or refinement of the exact same task, modify the existing plan while cleaning up outdated or irrelevant sections
4. Continue with the plan process and most importantly you should always edit the plan file one way or the other before calling exit_plan_mode

Treat this as a fresh planning session. Do not assume the existing plan is relevant without evaluating it first.`;
}

export function buildExitInstructions(planFilePath: string | undefined): string {
	const planReference =
		planFilePath === undefined ? "" : ` The plan file is located at ${planFilePath} if you need to reference it.`;
	return `## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.${planReference}`;
}
