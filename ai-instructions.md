# AI/LLM Instructions

This file contains instructions for AI assistants working on this codebase. Read this before making any changes.

## 1. Communication Requirements

### Always Check First
- **NEVER** start coding without explaining your plan and getting approval.
- Present your approach in clear steps.
- Wait for explicit approval before implementing.
- If unsure about the approach, present multiple options.

### Step-by-Step Implementation
- Implement changes one step at a time.
- Wait for confirmation after each step before proceeding.
- Show exactly where code changes will be made.
- For edits: provide either the complete file (if small) or precise insertion points.

### Fast-Track for Trivial Changes
- For changes deemed trivial (e.g., fixing typos in non-user-facing text), you may bundle the explanation and implementation into a single step.
- You must explicitly label the change as **"Trivial Fix"** and proceed with caution.

---
## 2. Code Modification Rules

### Never Delete Without Permission
- Do NOT remove code sections when fixing other issues.
- If deletion seems necessary, explain why and get approval first.
- Comment out code rather than deleting if preservation might be needed.

### Preserve Existing Functionality
- Ensure all existing features continue working.
- Run existing tests before and after changes.
- If breaking changes are needed, discuss them first.

### Scope Boundaries
- Stick to the agreed changes only.
- Do not "improve" unrelated code.
- Do not refactor without permission.
- If you notice other issues, note them separately.

---
## 3. Testing Requirements

### Real Tests Only
- Write actual, runnable tests—never fake or stub them.
- Test edge cases and error conditions.
- Verify tests actually fail when the code is broken.
- Include both positive and negative test cases.
- If modifying a known performance-sensitive area, note the potential performance impact and suggest a benchmark to validate that performance has not regressed.

### Test Before Submitting
- Run all tests locally (if possible to simulate).
- Show test output in your response.
- Explain what each test validates.

---
## 4. Error Handling

### Debugging Approach
- Use systematic debugging, not guesswork.
- Preserve error messages and stack traces.
- Explain your debugging reasoning.
- If stuck, say so—don't guess wildly.

### Uncertainty Protocol
- Clearly state when you're unsure.
- Provide confidence levels for suggestions.
- Offer multiple solutions when uncertain.
- Ask for clarification rather than assume.

### Handling Non-Reproducible Bugs
- If you are unable to reproduce a reported bug, document the exact steps and environment you used for testing.
- Then, ask for more specific reproduction steps, environment details, or logs from the user.

---
## 5. Documentation

### Code Comments
- Add comments for complex logic.
- Update existing comments when changing code.
- Use clear, concise language.
- Include "why" not just "what."

### Avoid Conversation-Specific Comments
- DO NOT add comments about the change itself (e.g. `// Changed colour to blue`).
- DO NOT reference our conversation (e.g. `// As requested` or `// Fixed as discussed`).
- DO NOT state the obvious (e.g. `// This is a function` or `// Setting variable`).
- DO write comments that explain business logic, complex algorithms, or non-obvious decisions.
- Comments should make sense to someone reading the code in 6 months with no context.

### Documentation Updates
- Update the README if functionality changes.
- Keep API documentation current.
- Note any new dependencies.
- Document configuration changes.
- If your changes alter the system's architecture or data flow, check for corresponding diagrams (e.g., Mermaid, PlantUML) in the repository and note if they require updates.

---
## 6. Code Practices

### General Standards
- Follow existing code style and conventions.
- Maintain consistent naming patterns.
- Keep functions focused and small.
- Prioritize readability over cleverness.

### Dependencies
- Explain why each new dependency is needed.
- Check for existing solutions before adding new packages.
- Consider security and maintenance implications.
- Use exact versions, not ranges.

---
## 7. Explanation Requirements

### Code Explanations
- Explain the reasoning behind implementation choices.
- Present trade-offs when relevant.
- Note any assumptions made.
- Highlight potential risks or limitations.
- For any changes involving user input, authentication, or external data, you must include a subsection in your explanation titled **"Security Considerations"** that details potential risks and how your code mitigates them.

### Change Summaries
- Provide a clear summary of what changed.
- Explain why the changes were necessary.
- List any side effects or impacts.
- Note what testing was performed.

---
## 8. When Stuck

### Getting Help
- Ask for clarification immediately when confused.
- Don't waste time guessing about requirements.
- Present what you understand and what's unclear.
- Suggest how to move forward.

### Presenting Options
- When multiple approaches exist, present 2-3 options.
- Include pros/cons for each.
- Make a recommendation with reasoning.
- Wait for a decision before proceeding.

---
## 9. Review Process

### Presenting Changes
- Show diffs clearly.
- Summarize what changed and why.
- Highlight any concerns or uncertainties.
- Ask specific questions if needed.

### Format Preferences
- Use markdown code blocks with language tags.
- Show file paths clearly.
- Indicate line numbers for insertions.
- Separate different files clearly.

---

**Remember:** When in doubt, ask. It's better to clarify than to guess and create problems.