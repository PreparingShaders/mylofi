# Plan: AI Synergy Backend Expert Prompt Enhancement & Tone Integration

## Goals
1. **Dynamic Tone/Persona Adaptation:**
   - Modify `build_synergy_prompt` in `app/services/ai_synergy_service.py` to correctly utilize `user.ai_persona_custom_text` when the selected persona is "custom".
   - Inject the actual custom text as system instructions for the LLM.
2. **Expert Synergy Analysis Enforcement:**
   - Strengthen the prompt to mandate deep causal analysis: instruct the model to explicitly link diet/nutrition/sleep data with training outcomes (tonnage, RPE).
   - Require explaining *why* current metrics lead to predicted results in 2–4 weeks.
   - Clarify the requirement for high-level expertise (sports nutritionist + elite trainer).
3. **JSON Contract & Style Compliance:**
   - Confirm strict JSON structure and `tone` (`success`, `warning`, `risk`) adherence in prompts.
4. **Validation:**
   - Test that persona settings (including custom) correctly influence response tone while maintaining rigorous expert-level analysis and valid JSON contract.

---

## Proposed Changes (`app/services/ai_synergy_service.py`)
- **`build_synergy_prompt`:**
  - Enhance persona handling logic.
  - Revise the system instruction block to mandate causal chain analysis and high-level sports expert tone.
  - Re-verify strict JSON output format.

---

## Validation & Verification
1. Run `pytest` to ensure all existing rules and synergy service tests pass.
2. Perform manual validation of generated report content, persona adherence, and JSON structure consistency.
